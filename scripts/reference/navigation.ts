export type NavGroup = {
  group: string
  pages: (string | NavGroup)[]
}

type NavigationTarget = {
  tab: string
  menuItem?: string
  section: string
}

type OwnershipDestination = {
  path: string
  owner: string
  collaborators: string[]
  content: string
  [key: string]: unknown
}

type OwnershipManifest = {
  destinations: OwnershipDestination[]
  [key: string]: unknown
}

type PathsFixture = {
  paths: string[]
  [key: string]: unknown
}

function sectionPages(docs: any, target: NavigationTarget): unknown[] {
  const tabs = docs.navigation?.tabs
  if (!Array.isArray(tabs)) {
    throw new Error('docs.json has no navigation.tabs')
  }

  const host = tabs.find((entry: any) => entry.tab === target.tab)
  if (!host) throw new Error(`navigation tab "${target.tab}" not found`)

  if (!target.menuItem) {
    if (!Array.isArray(host.pages)) {
      throw new Error(`navigation tab "${target.tab}" has no pages array`)
    }
    return host.pages
  }

  if (!Array.isArray(host.menu)) {
    throw new Error(`navigation tab "${target.tab}" has no menu array`)
  }
  const item = host.menu.find((entry: any) => entry.item === target.menuItem)
  if (!item || !Array.isArray(item.pages)) {
    throw new Error(
      `navigation menu item "${target.menuItem}" not found in tab "${target.tab}"`,
    )
  }
  return item.pages
}

export function patchReferenceNavigation(
  docs: any,
  pages: (string | NavGroup)[],
  target: NavigationTarget,
): any {
  const hostPages = sectionPages(docs, target)
  const matches = hostPages.flatMap((entry, index) =>
    typeof entry === 'object' &&
    entry !== null &&
    'group' in entry &&
    (entry as { group?: unknown }).group === target.section
      ? [index]
      : [],
  )
  if (matches.length > 1) {
    throw new Error(`duplicate navigation group "${target.section}"`)
  }

  const section = { group: target.section, pages }
  if (matches.length === 1) hostPages[matches[0]] = section
  else hostPages.push(section)
  return docs
}

export function collectReferencePages(pages: (string | NavGroup)[]): string[] {
  return pages.flatMap((entry) =>
    typeof entry === 'string' ? [entry] : collectReferencePages(entry.pages),
  )
}

function inferredDestination(
  path: string,
  previous: OwnershipDestination[],
  defaultOwner?: string,
): OwnershipDestination {
  const exact = previous.find((entry) => entry.path === path)
  if (exact) return exact

  const relatives = previous.map((entry) => ({
    entry,
    relative: entry.path.split('/sdk-reference/')[1] ?? '',
  }))
  let directory =
    path.split('/sdk-reference/')[1]?.split('/').slice(0, -1) ?? []
  while (directory.length) {
    const prefix = `${directory.join('/')}/`
    const candidates = relatives.filter(({ relative }) =>
      relative.startsWith(prefix),
    )
    const owners = new Set(candidates.map(({ entry }) => entry.owner))
    if (owners.size === 1) {
      return {
        path,
        owner: candidates[0].entry.owner,
        collaborators: [],
        content: 'generated',
      }
    }
    directory = directory.slice(0, -1)
  }

  if (defaultOwner) {
    return {
      path,
      owner: defaultOwner,
      collaborators: [],
      content: 'generated',
    }
  }
  throw new Error(
    `no ownership metadata can be inferred for generated page: ${path}`,
  )
}

export function syncGeneratedInventories(
  ownership: OwnershipManifest,
  fixture: PathsFixture,
  generatedPaths: string[],
  navBase: string,
  defaultOwner?: string,
): { ownership: OwnershipManifest; fixture: PathsFixture } {
  if (!Array.isArray(ownership.destinations)) {
    throw new Error('ownership manifest has no destinations array')
  }
  if (!Array.isArray(fixture.paths)) {
    throw new Error('SDK reference fixture has no paths array')
  }

  const isManaged = ({ path, content }: OwnershipDestination) =>
    content === 'generated' && path.startsWith(`${navBase}/`)
  const previous = ownership.destinations.filter(isManaged)
  const firstGenerated = ownership.destinations.findIndex(isManaged)
  if (firstGenerated < 0) {
    throw new Error('ownership manifest has no generated destinations')
  }

  const generated = generatedPaths.map((path) => {
    if (!path.startsWith(`${navBase}/`)) {
      throw new Error(`generated page is outside navigation base: ${path}`)
    }
    return inferredDestination(path, previous, defaultOwner)
  })
  const unrelated = ownership.destinations.filter(
    (destination) => !isManaged(destination),
  )
  unrelated.splice(firstGenerated, 0, ...generated)

  return {
    ownership: { ...ownership, destinations: unrelated },
    fixture: {
      ...fixture,
      paths: generatedPaths
        .map((path) => path.slice(navBase.length + 1))
        .sort(),
    },
  }
}
