export class AsyncBarrier {
  readonly #controller = new AbortController()
  readonly #gate = new Promise<void>((resolve) => {
    this.#controller.signal.addEventListener("abort", () => resolve(), { once: true })
  })
  #remaining: number

  constructor(participantCount: number) {
    this.#remaining = participantCount
  }

  async arriveAndWait(): Promise<void> {
    this.#remaining -= 1
    if (this.#remaining === 0) this.#controller.abort()
    await this.#gate
  }
}
