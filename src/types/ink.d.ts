declare module "ink" {
  import { FC, ComponentType, ReactNode } from "react";
  
  export interface BoxProps {
    flexDirection?: "row" | "column" | "row-reverse" | "column-reverse";
    justifyContent?: "flex-start" | "flex-end" | "center" | "space-between" | "space-around";
    alignItems?: "flex-start" | "flex-end" | "center" | "stretch";
    paddingX?: number;
    paddingY?: number;
    padding?: number;
    marginBottom?: number;
    marginTop?: number;
    marginLeft?: number;
    marginY?: number;
    marginX?: number;
    borderStyle?: "single" | "double" | "round" | "bold" | "singleDouble" | "doubleSingle" | "classic" | "arrow";
    borderColor?: string;
    children?: ReactNode;
    flexGrow?: number;
    width?: number | string;
    minWidth?: number;
    height?: number | string;
    overflow?: "visible" | "hidden";
  }

  export interface TextProps {
    children?: ReactNode;
    color?: string;
    backgroundColor?: string;
    dimColor?: boolean;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    inverse?: boolean;
    wrap?: "truncate" | "truncate-start" | "truncate-middle" | "truncate-end" | "wrap";
  }

  export function useInput(
    inputHandler: (input: string, key: any) => void,
    options?: { isActive?: boolean }
  ): void;

  export function useApp(): { exit: (error?: Error) => void };

  export function render(
    element: ReactNode,
    options?: {
      exitOnCtrlC?: boolean;
      patchConsole?: boolean;
      stdout?: any;
      stdin?: any;
    }
  ): any;

  export const Box: FC<BoxProps & any>;
  export const Text: FC<TextProps & any>;
}

declare module "ink-text-input" {
  import { FC } from "react";
  
  export interface TextInputProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit?: (value: string) => void;
    placeholder?: string;
    focus?: boolean;
    mask?: string;
    showCursor?: boolean;
    highlightPastedText?: boolean;
  }

  const TextInput: FC<TextInputProps>;
  export default TextInput;
}