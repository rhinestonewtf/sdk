function getCustomUrl(
  chainId: number,
  urls: Record<number, string>,
): string | undefined {
  return urls[chainId]
}

export { getCustomUrl }
