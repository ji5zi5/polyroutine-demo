export class DuplicateEmailError extends Error {
  override readonly name = "DuplicateEmailError"

  constructor() {
    super("an account already exists for this email")
  }
}
