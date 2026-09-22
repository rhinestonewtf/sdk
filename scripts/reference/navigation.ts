export type NavGroup = {
  group: string
  pages: (string | NavGroup)[]
}

const HOST_TAB = 'Wallets'
const HOST_MENU_ITEM = 'Custom signer'
const SECTION_NAME = 'SDK reference'

function uniqueMatch<T>(
  entries: T[],
  matches: (entry: T) => boolean,
  missingMessage: string,
  duplicateMessage: string,
): T {
  const found = entries.filter(matches)
  if (found.length === 0) throw new Error(missingMessage)
  if (found.length > 1) throw new Error(duplicateMessage)
  return found[0]
}

function referenceSectionPages(docs: any): unknown[] {
  const tabs = docs?.navigation?.tabs
  if (!Array.isArray(tabs)) {
    throw new Error('docs.json has no navigation.tabs array')
  }

  const host = uniqueMatch(
    tabs,
    (entry: any) => entry?.tab === HOST_TAB,
    `navigation tab "${HOST_TAB}" not found`,
    `duplicate navigation tab "${HOST_TAB}"`,
  ) as any
  if (!Array.isArray(host.menu)) {
    throw new Error(`navigation tab "${HOST_TAB}" has no menu array`)
  }

  const item = uniqueMatch(
    host.menu,
    (entry: any) => entry?.item === HOST_MENU_ITEM,
    `navigation menu item "${HOST_MENU_ITEM}" not found in tab "${HOST_TAB}"`,
    `duplicate navigation menu item "${HOST_MENU_ITEM}" in tab "${HOST_TAB}"`,
  ) as any
  if (!Array.isArray(item.pages)) {
    throw new Error(
      `navigation menu item "${HOST_MENU_ITEM}" in tab "${HOST_TAB}" has no pages array`,
    )
  }
  return item.pages
}

export function patchReferenceNavigation(
  docs: any,
  pages: (string | NavGroup)[],
): any {
  const hostPages = referenceSectionPages(docs)
  const matches = hostPages.flatMap((entry, index) =>
    typeof entry === 'object' &&
    entry !== null &&
    'group' in entry &&
    (entry as { group?: unknown }).group === SECTION_NAME
      ? [index]
      : [],
  )
  if (matches.length > 1) {
    throw new Error(`duplicate navigation group "${SECTION_NAME}"`)
  }
  if (
    matches.length === 1 &&
    !Array.isArray((hostPages[matches[0]] as { pages?: unknown }).pages)
  ) {
    throw new Error(`navigation group "${SECTION_NAME}" has no pages array`)
  }

  const section = { group: SECTION_NAME, pages }
  if (matches.length === 1) hostPages[matches[0]] = section
  else hostPages.push(section)
  return docs
}
