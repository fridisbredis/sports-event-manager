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
// The border colour is the design handoff's #8C94A1 (`edge-field`), chosen to
// clear WCAG 3:1 against white for a UI boundary — HeroUI's own default is
// lighter than that and does not.
//
// Focus: the field lights up in the tenant's palette colour — a 2px primary
// border plus a soft tint halo, and the label switches to the primary tint
// text. HeroUI's `faded` variant gives focus no treatment of its own beyond a
// default focus ring, so all of it is added here. Written against
// `group-data-[focus=true]` (the attribute HeroUI sets on the wrapper's group)
// rather than `:focus-within`, so it also covers the composite fields — Select,
// TimeInput, DateRangePicker — whose real focus lives on an inner segment.
const WHITE_FIELD = [
  'bg-white border-1 border-edge-field shadow-none',
  'transition-colors',
  'group-data-[focus=true]:border-2',
  'group-data-[focus=true]:border-tenant-primary',
  'group-data-[focus=true]:ring-4',
  'group-data-[focus=true]:ring-tenant-primary-tint',
].join(' ')

// Applied to every field's label so it takes the theme colour on focus,
// matching the border.
const FIELD_LABEL = 'group-data-[focus=true]:!text-tenant-primary-tint-text'

// Listbox rows in any popover — a Select's options, a Dropdown's menu.
// HeroUI highlights both hover and the selected row with its grey
// `default-100`; in a themed app that reads as a dead spot next to
// everything else the palette touches. Exported so the plain HeroUI
// Dropdowns (which don't go through the Select wrapper below) can share it.
//
// `data-[hover=true]` and `data-[selected=true]` are the attributes HeroUI
// sets on the item itself, so no group selector is needed. The `!` prefixes
// are required: HeroUI's own colour classes land on the same element at
// equal specificity, and without them the grey simply wins by source order.
export const LISTBOX_ITEM = [
  'data-[hover=true]:!bg-tenant-primary-tint',
  'data-[hover=true]:!text-tenant-primary-tint-text',
  'data-[selected=true]:!bg-tenant-primary-tint',
  'data-[selected=true]:!text-tenant-primary-tint-text',
  'data-[focus-visible=true]:!bg-tenant-primary-tint',
].join(' ')

export function Input(props: InputProps) {
  return (
    <HeroInput
      variant="faded"
      {...props}
      classNames={{
        ...props.classNames,
        label: `${FIELD_LABEL} ${props.classNames?.label ?? ''}`,
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
        label: `${FIELD_LABEL} ${props.classNames?.label ?? ''}`,
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
        label: `${FIELD_LABEL} ${props.classNames?.label ?? ''}`,
        trigger: `${WHITE_FIELD} ${props.classNames?.trigger ?? ''}`,
      }}
      listboxProps={{
        ...props.listboxProps,
        itemClasses: {
          ...props.listboxProps?.itemClasses,
          base: `${LISTBOX_ITEM} ${props.listboxProps?.itemClasses?.base ?? ''}`,
        },
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
        label: `${FIELD_LABEL} ${props.classNames?.label ?? ''}`,
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
        label: `${FIELD_LABEL} ${props.classNames?.label ?? ''}`,
        inputWrapper: `${WHITE_FIELD} ${props.classNames?.inputWrapper ?? ''}`,
      }}
    />
  )
}
