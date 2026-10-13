import type { SymbolEntry } from './manifest'

type TDNode = any

export function createRenderer(context: {
  nameToPage: Map<string, string | null>
  classComment?: (entry: SymbolEntry) => TDNode | undefined
}) {
  const { nameToPage } = context
  // All call signatures for a symbol (an overloaded method has more than one).
  function signaturesOf(node: TDNode, entry: SymbolEntry): TDNode[] {
    if (!node) return []
    if (entry.callStyle === 'constructor') {
      const ctor =
        node.kind === 512
          ? node
          : (node.children ?? []).find((c: TDNode) => c.kind === 512)
      return ctor?.signatures ?? []
    }
    return node.signatures ?? []
  }

  // ---------------------------------------------------------------------------
  // Type rendering (types are out of scope as pages — render as plain names)
  // ---------------------------------------------------------------------------

  function typeToString(t: TDNode | undefined): string {
    if (!t) return 'unknown'
    switch (t.type) {
      case 'intrinsic':
        return t.name
      case 'literal':
        return typeof t.value === 'string' ? `'${t.value}'` : String(t.value)
      case 'reference': {
        // Drop type arguments when they expand to something huge (e.g. viem's
        // TypedDataDefinition) — the bare name is far more readable.
        const inner = (t.typeArguments ?? []).map(typeToString).join(', ')
        const args = inner && inner.length <= 40 ? `<${inner}>` : ''
        return `${t.name}${args}`
      }
      case 'array':
        return `${typeToString(t.elementType)}[]`
      case 'union':
        return t.types.map(typeToString).join(' | ')
      case 'intersection':
        return t.types.map(typeToString).join(' & ')
      case 'tuple':
        return `[${(t.elements ?? []).map(typeToString).join(', ')}]`
      case 'reflection': {
        const d = t.declaration
        if (d?.signatures?.length) {
          const sig = d.signatures[0]
          const params = (sig.parameters ?? [])
            .map((p: TDNode) => `${p.name}: ${typeToString(p.type)}`)
            .join(', ')
          return `(${params}) => ${typeToString(sig.type)}`
        }
        if (d?.children?.length) {
          const fields = d.children
            .map((c: TDNode) => `${c.name}: ${typeToString(c.type)}`)
            .join('; ')
          return fields.length <= 80 ? `{ ${fields} }` : 'object'
        }
        return '{}'
      }
      case 'indexedAccess':
        return `${typeToString(t.objectType)}[${typeToString(t.indexType)}]`
      case 'typeOperator':
        return `${t.operator} ${typeToString(t.target)}`
      case 'query':
        return `typeof ${typeToString(t.queryType)}`
      case 'templateLiteral': {
        const tail = (t.tail ?? [])
          .map(
            ([type, lit]: [TDNode, string]) =>
              `\${${typeToString(type)}}${lit}`,
          )
          .join('')
        return `\`${t.head}${tail}\``
      }
      case 'named-tuple-member':
        return `${t.name}: ${typeToString(t.element)}`
      case 'optional':
        return `${typeToString(t.elementType)}?`
      case 'rest':
        return `...${typeToString(t.elementType)}`
      case 'conditional':
        return `${typeToString(t.checkType)} extends ${typeToString(t.extendsType)} ? ${typeToString(t.trueType)} : ${typeToString(t.falseType)}`
      case 'mapped':
        return t.name ?? 'object'
      default:
        return t.name ?? 'unknown'
    }
  }

  function unwrapPromise(t: TDNode | undefined): TDNode | undefined {
    if (t?.type === 'reference' && t.name === 'Promise') {
      return t.typeArguments?.[0] ?? t
    }
    return t
  }

  // Names for the single return value, where the verb-stripped default is wrong.
  const RETURN_NAME_OVERRIDES: Record<string, string> = {
    signMessage: 'signature',
    signTypedData: 'signature',
    signEip7702InitData: 'signature',
    signEnableSession: 'signature',
    signIntent: 'signatures',
    waitForExecution: 'result',
    deploy: 'success',
    setup: 'success',
    toViewOnlyAccount: 'account',
  }

  const RETURN_VERBS =
    /^(get|set|is|has|sign|prepare|submit|send|create|wait|split|deploy|setup|check|to|enable|disable|add|remove|change|recover|install|uninstall)/

  // A meaningful name for the returned value (e.g. getAddress -> "address"),
  // used for both the ResponseField name and the usage snippet's variable.
  function returnFieldName(entry: SymbolEntry): string {
    if (entry.callStyle === 'action') return 'call'
    if (RETURN_NAME_OVERRIDES[entry.symbol]) {
      return RETURN_NAME_OVERRIDES[entry.symbol]
    }
    const base = entry.symbol.replace(/^experimental_/, '')
    const m = base.match(RETURN_VERBS)
    if (m) {
      const rest = base.slice(m[0].length)
      if (rest) return rest.charAt(0).toLowerCase() + rest.slice(1)
    }
    return 'result'
  }

  // Split a rendered summary into a one-line description (first paragraph) and an
  // optional extended explainer (the remaining paragraphs).
  function splitSummary(summary: string): { short: string; rest: string } {
    const paras = summary.split(/\n\s*\n/)
    return {
      short: oneLine(paras[0] ?? ''),
      rest: paras.slice(1).join('\n\n').trim(),
    }
  }

  // Returns the properties of an object-literal type, or undefined if the type is
  // not a plain object literal (named types and unions are left as a single row).
  function objectFields(t: TDNode | undefined): TDNode[] | undefined {
    if (
      t?.type === 'reflection' &&
      t.declaration?.children?.length &&
      !t.declaration.signatures?.length
    ) {
      return t.declaration.children
    }
    return undefined
  }

  // ---------------------------------------------------------------------------
  // Comment / doc-comment rendering
  // ---------------------------------------------------------------------------

  function renderParts(parts: TDNode[] | undefined): string {
    if (!parts) return ''
    return parts
      .map((p) => {
        if (p.kind === 'inline-tag' && p.tag === '@link') {
          const label = p.text?.trim() ?? ''
          const target = label.replace(/\(\)$/, '')
          const page = nameToPage.get(target)
          return page ? `[${label}](/${page})` : `\`${label}\``
        }
        return p.text ?? ''
      })
      .join('')
      .trim()
  }

  function blockTag(comment: TDNode | undefined, tag: string): TDNode[] {
    return (comment?.blockTags ?? []).filter((t: TDNode) => t.tag === tag)
  }

  // ---------------------------------------------------------------------------
  // Page rendering
  // ---------------------------------------------------------------------------

  function isOmittable(parameter: TDNode): boolean {
    return !!parameter.flags?.isOptional || parameter.defaultValue !== undefined
  }

  function importLine(entry: SymbolEntry): string {
    const name = entry.callStyle === 'constructor' ? entry.symbol : entry.symbol
    return `import { ${name} } from '@rhinestone/sdk${entry.source === '.' ? '' : entry.source.replace(/^\./, '')}'`
  }

  function usageSnippet(entry: SymbolEntry, sig: TDNode | undefined): string {
    const parameters: TDNode[] = sig?.parameters ?? []
    const paramNames = parameters.map((p) => p.name)
    const lastRequired = parameters.reduce(
      (last, parameter, index) => (isOmittable(parameter) ? last : index),
      -1,
    )
    const params = parameters
      .slice(0, lastRequired + 1)
      .map((p) => (isOmittable(p) ? 'undefined' : p.name))
      .join(', ')
    const isPromise =
      sig?.type?.type === 'reference' && sig.type.name === 'Promise'
    const awaitKw = isPromise ? 'await ' : ''
    const ret = isPromise ? sig.type.typeArguments?.[0] : sig?.type
    // Avoid shadowing a parameter with the return variable (TDZ / invalid example).
    let varName = returnFieldName(entry)
    if (paramNames.includes(varName)) {
      varName =
        ['result', 'output', 'value', 'res'].find(
          (c) => !paramNames.includes(c),
        ) ?? `${varName}_`
    }
    const assign =
      ret && !(ret.type === 'intrinsic' && ret.name === 'void')
        ? `const ${varName} = `
        : ''
    switch (entry.callStyle) {
      case 'accountMethod':
        return `${assign}${awaitKw}account.${entry.symbol}(${params})`
      case 'sdkMethod':
        return `${assign}${awaitKw}sdk.${entry.symbol}(${params})`
      case 'constructor':
        return `const sdk = new ${entry.symbol}({\n  auth: { mode: 'apiKey', apiKey },\n})`
      case 'action': {
        // Actions produce calls passed to prepareTransaction on an account.
        // Some return a single call, others a Promise of a calls array — shape
        // the snippet accordingly so it stays valid.
        const retT = sig?.type
        const isProm = retT?.type === 'reference' && retT.name === 'Promise'
        const inner = isProm ? retT.typeArguments?.[0] : retT
        const call = `${isProm ? 'await ' : ''}${entry.symbol}(${params})`
        const calls = inner?.type === 'array' ? call : `[${call}]`
        return [
          `// Requires sponsorship enabled for your project.`,
          `const transaction = await account.prepareTransaction({`,
          `  destination: {`,
          `    chain,`,
          `    calls: ${calls},`,
          `  },`,
          `  sponsored: true,`,
          `})`,
        ].join('\n')
      }
      default:
        return `${assign}${awaitKw}${entry.symbol}(${params})`
    }
  }

  function instanceNote(entry: SymbolEntry): string | undefined {
    if (entry.callStyle === 'accountMethod') {
      const page = nameToPage.get('createAccount')
      const link = page ? `[\`createAccount\`](/${page})` : '`createAccount`'
      const capability = {
        RhinestoneAccountBase:
          'VM-neutral method; pass a configured VM. EVM addresses use `Address`, Solana addresses use `SolanaAddress`; widened configurations may also return `undefined`.',
        ManagedTransactionAccount:
          'Requires a managed transaction account (EVM or managed Solana); unavailable on receiver-only and standalone Solana accounts.',
        ManagedEvmAccount:
          'Requires a managed EVM account; unavailable on receiver-only and standalone Solana accounts.',
        SolanaStandaloneAccount: 'Requires a standalone Solana account.',
        RhinestoneSDK: '',
      }[entry.container ?? 'RhinestoneAccountBase']
      return `Method on an account instance returned by ${link}. ${capability}`
    }
    if (entry.callStyle === 'sdkMethod') {
      const page = nameToPage.get('RhinestoneSDK')
      const link = page ? `[\`RhinestoneSDK\`](/${page})` : '`RhinestoneSDK`'
      return `Method on a ${link} instance.`
    }
    return undefined
  }

  function renderPage(entry: SymbolEntry, node: TDNode): string {
    const sigs = [...signaturesOf(node, entry)]
    // Optional options identify ordinary signing without depending on TypeDoc IDs.
    if (entry.symbol === 'signTransaction') {
      sigs.sort(
        (a, b) =>
          Number(
            !a.parameters?.find(
              (p: TDNode) => p.name === 'options' && isOmittable(p),
            ),
          ) -
          Number(
            !b.parameters?.find(
              (p: TDNode) => p.name === 'options' && isOmittable(p),
            ),
          ),
      )
    }
    const sig = sigs[0]
    const isCtor = entry.callStyle === 'constructor'
    const sigComment = sig?.comment
    // For a constructor page, the page-level prose lives on the class comment;
    // params/returns come from the constructor signature.
    const docComment = isCtor
      ? (context.classComment?.(entry) ?? sigComment)
      : (sigComment ?? node.comment)
    const comment = docComment
    const title = entry.title ?? entry.symbol
    const { short, rest } = splitSummary(renderParts(comment?.summary))

    const out: string[] = []
    out.push('---')
    out.push(`title: ${yaml(title)}`)
    if (short) out.push(`description: ${yaml(stripMd(short))}`)
    out.push('---')
    out.push('')

    if (entry.experimental) {
      out.push(
        '<Warning>This API is experimental and may change in a future release.</Warning>',
      )
      out.push('')
    }

    // The one-line summary is rendered by Mintlify from the frontmatter
    // `description`; only the extended explainer (if any) goes in the body.
    if (rest) {
      out.push(rest)
      out.push('')
    }

    for (const r of blockTag(comment, '@remarks')) {
      out.push(`<Note>${oneLine(renderParts(r.content))}</Note>`)
      out.push('')
    }

    const note = instanceNote(entry)
    if (note) {
      out.push(note)
      out.push('')
    }

    // Import (only for directly-importable symbols).
    if (
      entry.callStyle === 'function' ||
      entry.callStyle === 'action' ||
      entry.callStyle === 'constructor'
    ) {
      out.push('## Import')
      out.push('')
      out.push('```ts')
      out.push(importLine(entry))
      out.push('```')
      out.push('')
    }

    out.push('## Usage', '')
    const contracts = sigs.length ? sigs : [undefined]
    for (const [index, contract] of contracts.entries()) {
      const overloaded = contracts.length > 1
      const contractComment =
        contract?.comment ?? (overloaded ? undefined : docComment)
      let label = `Overload ${index + 1}`
      if (entry.symbol === 'signTransaction') {
        label = contract?.parameters?.some(
          (p: TDNode) => p.name === 'options' && isOmittable(p),
        )
          ? 'Ordinary signing'
          : 'Independent owner signing'
      } else if (entry.symbol === 'waitForExecution') {
        label =
          typeToString(contract?.parameters?.[0]?.type) ===
          'UserOperationResult'
            ? 'UserOperation receipt'
            : 'Intent result'
      }
      if (overloaded) {
        out.push(`### ${label}`, '')
        const summary = renderParts(contractComment?.summary)
        if (summary) out.push(summary, '')
        for (const remark of blockTag(contractComment, '@remarks')) {
          out.push(`<Note>${oneLine(renderParts(remark.content))}</Note>`, '')
        }
      }
      const examples = [
        ...blockTag(isCtor ? docComment : contractComment, '@example'),
        ...(isCtor && contractComment && contractComment !== docComment
          ? blockTag(contractComment, '@example')
          : []),
      ]
      if (examples.length) {
        for (const example of examples)
          out.push(renderParts(example.content), '')
      } else {
        let snippet = usageSnippet(entry, contract)
        if (
          entry.symbol === 'signTransaction' &&
          label === 'Independent owner signing'
        ) {
          snippet = snippet.replace(', options)', ', { owner })')
        }
        out.push('```ts', snippet, '```', '')
      }

      const heading = overloaded ? '####' : '##'
      const params: TDNode[] = contract?.parameters ?? []
      if (params.length) {
        out.push(`${heading} Parameters`, '')
        for (const parameter of params) {
          const required = isOmittable(parameter) ? '' : ' required'
          out.push(
            `<ParamField path="${parameter.name}" type="${escapeAttr(typeToString(parameter.type))}"${required}>`,
          )
          const desc = renderParts(parameter.comment?.summary)
          if (desc) out.push(`  ${desc}`)
          if (parameter.defaultValue !== undefined)
            out.push(`  Default: \`${parameter.defaultValue}\`.`)
          out.push('</ParamField>', '')
        }
      }

      const retType = unwrapPromise(contract?.type)
      if (
        retType &&
        !(retType.type === 'intrinsic' && retType.name === 'void') &&
        !isCtor
      ) {
        out.push(`${heading} Returns`, '')
        const desc = renderParts(
          blockTag(contractComment, '@returns')[0]?.content,
        )
        const fields = objectFields(retType)
        if (fields) {
          if (desc) out.push(desc, '')
          for (const field of fields) {
            const required = field.flags?.isOptional ? '' : ' required'
            out.push(
              `<ResponseField name="${field.name}" type="${escapeAttr(typeToString(field.type))}"${required}>`,
              '</ResponseField>',
              '',
            )
          }
        } else {
          out.push(
            `<ResponseField name="${returnFieldName(entry)}" type="${escapeAttr(typeToString(retType))}">`,
          )
          if (desc) out.push(`  ${desc}`)
          out.push('</ResponseField>', '')
        }
      }
    }

    // See also. TypeDoc merges consecutive @see tags into one blockTag whose
    // content already carries `-` bullets, so normalize rather than re-bullet.
    const sees = sigs.length
      ? sigs.flatMap((contract) => blockTag(contract.comment, '@see'))
      : blockTag(docComment, '@see')
    if (sees.length) {
      out.push('## See also')
      out.push('')
      for (const s of sees) {
        for (const line of renderParts(s.content).split('\n')) {
          const t = line.trim().replace(/^-\s*/, '')
          if (t) out.push(`- ${t}`)
        }
      }
      out.push('')
    }

    return `${out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd()}\n`
  }

  function oneLine(s: string): string {
    return s.replace(/\s*\n\s*/g, ' ').trim()
  }

  function escapeAttr(s: string): string {
    return s.replace(/"/g, "'")
  }

  // Quote a value for YAML frontmatter (descriptions may contain `:` etc.).
  function yaml(s: string): string {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }

  // Strip markdown links/code from a string destined for frontmatter prose.
  function stripMd(s: string): string {
    return s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/`/g, '')
  }

  return { renderPage, usageSnippet, typeToString, instanceNote }
}
