import { type ReactNode, useId } from "react"

type StatusPanelState =
  | { readonly kind: "ready"; readonly label: string }
  | { readonly kind: "pending"; readonly label: string }
  | { readonly kind: "error"; readonly label: string }

type StatusPanelProps = {
  readonly action: ReactNode
  readonly children: ReactNode
  readonly className?: string
  readonly heading: string
  readonly state: StatusPanelState
}

class UnexpectedStatusError extends Error {
  override readonly name = "UnexpectedStatusError"
}

function assertNever(status: never): never {
  throw new UnexpectedStatusError(`unexpected status: ${JSON.stringify(status)}`)
}

function statusClassName(state: StatusPanelState): string {
  switch (state.kind) {
    case "ready":
      return "statusLabel statusReady"
    case "pending":
      return "statusLabel statusPending"
    case "error":
      return "statusLabel statusError"
    default:
      return assertNever(state)
  }
}

export function StatusPanel({ action, children, className, heading, state }: StatusPanelProps) {
  const headingId = useId()
  return (
    <section
      className={className === undefined ? "statusPanel" : `statusPanel ${className}`}
      aria-labelledby={headingId}
    >
      <p className={statusClassName(state)}>{state.label}</p>
      <h2 id={headingId}>{heading}</h2>
      <div className="panelCopy">{children}</div>
      <div className="panelAction">{action}</div>
    </section>
  )
}
