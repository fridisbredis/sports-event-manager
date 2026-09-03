---
name: heroui-tailwind
description: Use when building or modifying UI components that use HeroUI v2 and Tailwind CSS v3. Covers component selection, classNames slot styling, Tailwind plugin setup, and HeroUIProvider. Trigger on imports from @heroui/react, styling questions, or Tailwind theme work.
allowed-tools: [Read, Edit, Grep, Glob, Bash]
---

# HeroUI v2 + Tailwind v3

Procedure for building UI with HeroUI v2 on top of Tailwind CSS v3.

## 1. Verify the project setup

Before generating component code, confirm:

- `@heroui/react` is in `package.json` dependencies (version `^2.x`)
- `tailwind.config.ts` contains the `heroui()` plugin and the HeroUI content glob:

```ts
import { heroui } from '@heroui/react'

const config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}',
  ],
  plugins: [heroui()],
}
```

- `globals.css` uses standard Tailwind v3 directives:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- `HeroUIProvider` wraps the app in the root layout

If any of these are missing, stop and report — do not scaffold setup unless explicitly asked.

## 2. Choose a HeroUI component before writing JSX

Search the catalog before writing custom markup.

| Need                         | HeroUI v2 component                                                              |
| ---------------------------- | -------------------------------------------------------------------------------- |
| Button, icon button          | `Button`                                                                         |
| Text input, password, search | `Input`                                                                          |
| Select                       | `Select` + `SelectItem`                                                          |
| Autocomplete                 | `Autocomplete` + `AutocompleteItem`                                              |
| Modal / dialog               | `Modal` + `ModalContent` + `ModalHeader` + `ModalBody` + `ModalFooter`           |
| Tabular data                 | `Table` + `TableHeader` + `TableColumn` + `TableBody` + `TableRow` + `TableCell` |
| Card layout                  | `Card` + `CardHeader` + `CardBody` + `CardFooter`                                |
| Tabs                         | `Tabs` + `Tab`                                                                   |
| Tooltip                      | `Tooltip`                                                                        |
| Popover                      | `Popover` + `PopoverTrigger` + `PopoverContent`                                  |
| Loading state                | `Spinner`, `Skeleton`                                                            |
| Toast notification           | No built-in toast in v2 — use a third-party library                              |
| Navigation bar               | `Navbar` + `NavbarBrand` + `NavbarContent` + `NavbarItem`                        |
| Tag / label                  | `Chip`                                                                           |
| User avatar                  | `Avatar`, `AvatarGroup`                                                          |
| Dropdown menu                | `Dropdown` + `DropdownTrigger` + `DropdownMenu` + `DropdownItem`                 |
| Collapsible sections         | `Accordion` + `AccordionItem`                                                    |
| Page navigation              | `Pagination`                                                                     |
| Divider                      | `Divider`                                                                        |

If no component fits, use raw JSX with Tailwind.

**All components are named exports from `@heroui/react`.** Never import from sub-packages like `@heroui/button`.

**React Aria event props:** `Button` uses `onPress` (not `onClick`). Collection items like `DropdownItem` use `key` for identity; actions are handled via `onAction` on the parent `DropdownMenu`.

### Examples for complex compound patterns

**Modal**

```tsx
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button } from '@heroui/react'
import { useState } from 'react'

function Example() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onPress={() => setOpen(true)}>Open</Button>
      <Modal isOpen={open} onOpenChange={setOpen}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Title</ModalHeader>
              <ModalBody>Body content.</ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>
                  Cancel
                </Button>
                <Button color="primary" onPress={onClose}>
                  Confirm
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  )
}
```

**Dropdown**

```tsx
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Button } from '@heroui/react'
;<Dropdown>
  <DropdownTrigger>
    <Button variant="bordered">Actions</Button>
  </DropdownTrigger>
  <DropdownMenu onAction={(key) => console.log(key)}>
    <DropdownItem key="edit">Edit</DropdownItem>
    <DropdownItem key="delete" className="text-danger" color="danger">
      Delete
    </DropdownItem>
  </DropdownMenu>
</Dropdown>
```

**Table**

```tsx
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@heroui/react'
;<Table isStriped aria-label="Officials">
  <TableHeader>
    <TableColumn>Name</TableColumn>
    <TableColumn>Status</TableColumn>
  </TableHeader>
  <TableBody emptyContent="No officials found.">
    {items.map((item) => (
      <TableRow key={item.id}>
        <TableCell>{item.name}</TableCell>
        <TableCell>{item.status}</TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>
```

## 3. Style via `classNames` slot objects or `className`

HeroUI v2 uses slot-based styling. Top-level components accept a `classNames` prop with an object of slot names. Alternatively, pass `className` for the root element.

**classNames slot object (v2 pattern)**

```tsx
<Input
  classNames={{
    inputWrapper: 'border border-default-300',
    input: 'text-sm',
  }}
/>
```

**className on root (simpler cases)**

```tsx
<Button className="w-full">Submit</Button>
```

Available slots differ per component — check the HeroUI v2 docs or inspect the component's TypeScript types.

## 4. Color and variant props

Most components accept `color` and `variant` props:

- `color`: `"default"` | `"primary"` | `"secondary"` | `"success"` | `"warning"` | `"danger"`
- `variant` (Button): `"solid"` | `"bordered"` | `"light"` | `"flat"` | `"faded"` | `"shadow"` | `"ghost"`
- `variant` (Input): `"flat"` | `"bordered"` | `"faded"` | `"underlined"`
- `size`: `"sm"` | `"md"` | `"lg"`

## 5. Dark mode

HeroUI v2 dark mode is driven by adding `dark` class to `<html>`. Pass it via HeroUIProvider or set manually:

```tsx
// In layout.tsx
<html lang="en" className="dark">
```

Or use HeroUIProvider with a theme attribute wrapper. The `heroui()` plugin wires up Tailwind dark mode variant automatically.

## 6. Forms

HeroUI v2 `Input` is a single compound component, not a compound tree:

```tsx
import { Input, Button } from '@heroui/react'

<Input
  label="Phone"
  type="tel"
  value={phone}
  onValueChange={setPhone}
  isInvalid={!!error}
  errorMessage={error}
/>
<Button
  color="primary"
  isLoading={loading}
  onPress={submit}
>
  Submit
</Button>
```

Use `onValueChange` (not `onChange`) for controlled inputs — it receives the string value directly without an event object.

## 7. Component mapping for this project

| App pattern             | HeroUI v2                                          |
| ----------------------- | -------------------------------------------------- |
| Primary action button   | `Button color="primary"`                           |
| Secondary / cancel      | `Button variant="light"`                           |
| Destructive action      | `Button color="danger"`                            |
| Status badge            | `Chip` with appropriate `color`                    |
| Data table              | `Table isStriped` + `emptyContent` for empty state |
| Form input              | `Input` with `label`, `isInvalid`, `errorMessage`  |
| Select / dropdown field | `Select` + `SelectItem`                            |
| Modal / dialog          | `Modal` compound tree                              |
| Tabs                    | `Tabs` + `Tab`                                     |
| Collapsible section     | `Accordion` + `AccordionItem`                      |
| Loading                 | `Spinner` centered in flex container               |
| Row actions menu        | `Dropdown` compound tree                           |

## 8. Before finishing

- Confirm all imports come from `@heroui/react` — no sub-package imports
- Confirm `HeroUIProvider` is mounted at the root layout
- Confirm `tailwind.config.ts` has both the heroui plugin and the content glob
- Confirm `isLoading` (not `isPending`) on `Button` for loading state in v2
- Confirm `onValueChange` (not `onChange`) on `Input` for controlled value
- Run the project's lint and type-check before reporting done
