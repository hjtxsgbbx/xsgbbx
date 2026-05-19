/**
 * Command specification registry types.
 * Specs files import CommandSpec from here to type-check their command definitions.
 */

export type ArgSpec = {
  name: string
  description: string
  isOptional?: boolean
  isVariadic?: boolean
  isCommand?: boolean
}

export type OptionSpec = {
  name: string | string[]
  description: string
  args?: {
    name: string
    description?: string
    isOptional?: boolean
  }
}

export type CommandSpec = {
  name: string
  description: string
  args?: ArgSpec | ArgSpec[]
  options?: OptionSpec[]
}
