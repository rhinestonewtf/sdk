// Polyfill for Promise.withResolvers
if (!Promise.withResolvers) {
  Promise.withResolvers = <T>() => {
    let resolve: (value?: T | PromiseLike<T>) => void
    let reject: (reason?: any) => void

    const promise = new Promise<T>((res, rej) => {
      resolve = res as (value?: T | PromiseLike<T>) => void
      reject = rej
    })

    return { promise, resolve: resolve!, reject: reject! }
  }
}
