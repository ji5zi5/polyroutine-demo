export function normalizePlaywrightArguments(input) {
  const playwrightArguments = []
  const firstArgumentIndex = input[0] === "--" ? 1 : 0

  for (let index = firstArgumentIndex; index < input.length; index += 1) {
    const argument = input[index]
    if (argument === "--filter") {
      const value = input[index + 1]
      if (value === undefined) throw new TypeError("--filter requires a value")
      playwrightArguments.push("--grep", value)
      index += 1
    } else if (argument !== undefined) {
      playwrightArguments.push(argument)
    }
  }

  return playwrightArguments
}
