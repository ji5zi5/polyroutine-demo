import type { InputHTMLAttributes } from "react"

type FormFieldProps = {
  readonly error?: string
  readonly helper?: string
  readonly id: string
  readonly input: Omit<InputHTMLAttributes<HTMLInputElement>, "aria-describedby" | "id">
  readonly label: string
}

type CheckboxFieldProps = {
  readonly helper?: string
  readonly id: string
  readonly input: Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type">
  readonly label: string
}

export function FormField({ error, helper, id, input, label }: FormFieldProps) {
  const descriptionId =
    error === undefined ? (helper === undefined ? undefined : `${id}-helper`) : `${id}-error`
  return (
    <div className="formField">
      <label className="formLabel" htmlFor={id}>
        {label}
      </label>
      <input
        {...input}
        aria-describedby={descriptionId}
        aria-invalid={error === undefined ? undefined : true}
        className="formInput"
        id={id}
      />
      {error === undefined ? (
        helper === undefined ? null : (
          <p className="formHelper" id={`${id}-helper`}>
            {helper}
          </p>
        )
      ) : (
        <p className="formError" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export function CheckboxField({ helper, id, input, label }: CheckboxFieldProps) {
  return (
    <label className="checkboxField" htmlFor={id}>
      <input {...input} id={id} type="checkbox" />
      <span className="checkboxCopy">
        <span className="formLabel">{label}</span>
        {helper === undefined ? null : <span className="formHelper">{helper}</span>}
      </span>
    </label>
  )
}
