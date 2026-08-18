'use client'

import {
  Input as HeroInput,
  Textarea as HeroTextarea,
  Select as HeroSelect,
  TimeInput as HeroTimeInput,
  DateRangePicker as HeroDateRangePicker,
  type InputProps,
  type TextAreaProps,
  type SelectProps,
  type TimeInputProps,
  type DateRangePickerProps,
} from '@heroui/react'

// HeroUI's `flat` variant (the default) sets its gray background via
// `group-data-[focus=true]:bg-default-100`, which beats a plain `bg-white`
// override in specificity. `faded` doesn't carry a focus-state background
// class at all, so a single `bg-white` here wins in every state (rest,
// hover, focus) without needing `!important` on every call site. `faded`
// also renders a `border-medium` (2px) border and a `shadow-sm` by default
// — thinned to `border-1` and dropped to match the app's flatter 1px-border
// style elsewhere.
const WHITE_FIELD = 'bg-white border-1 shadow-none'

export function Input(props: InputProps) {
  return (
    <HeroInput
      variant="faded"
      {...props}
      classNames={{
        ...props.classNames,
        inputWrapper: `${WHITE_FIELD} ${props.classNames?.inputWrapper ?? ''}`,
      }}
    />
  )
}

export function Textarea(props: TextAreaProps) {
  return (
    <HeroTextarea
      variant="faded"
      {...props}
      classNames={{
        ...props.classNames,
        inputWrapper: `${WHITE_FIELD} ${props.classNames?.inputWrapper ?? ''}`,
      }}
    />
  )
}

export function Select(props: SelectProps) {
  return (
    <HeroSelect
      variant="faded"
      {...props}
      classNames={{
        ...props.classNames,
        trigger: `${WHITE_FIELD} ${props.classNames?.trigger ?? ''}`,
      }}
    />
  )
}

export function TimeInput(props: TimeInputProps) {
  return (
    <HeroTimeInput
      variant="faded"
      {...props}
      classNames={{
        ...props.classNames,
        inputWrapper: `${WHITE_FIELD} ${props.classNames?.inputWrapper ?? ''}`,
      }}
    />
  )
}

export function DateRangePicker(props: DateRangePickerProps) {
  return (
    <HeroDateRangePicker
      variant="faded"
      {...props}
      classNames={{
        ...props.classNames,
        inputWrapper: `${WHITE_FIELD} ${props.classNames?.inputWrapper ?? ''}`,
      }}
    />
  )
}
