"use client";

import { type FieldValues, type Path, type UseFormRegisterReturn } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type BaseProps<T extends FieldValues> = {
  name: Path<T>;
  label: string;
  error?: string;
  required?: boolean;
  className?: string;
};

type InputFieldProps<T extends FieldValues> = BaseProps<T> & {
  register: UseFormRegisterReturn;
  type?: "text" | "password" | "email" | "number" | "date" | "tel";
  placeholder?: string;
  disabled?: boolean;
  as?: "input";
};

type SelectFieldProps<T extends FieldValues> = BaseProps<T> & {
  register: UseFormRegisterReturn;
  as: "select";
  children: ReactNode;
  disabled?: boolean;
};

export function FormField<T extends FieldValues>(
  props: InputFieldProps<T> | SelectFieldProps<T>,
) {
  const { label, error, required, className, register, as } = props;

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={register.name}>
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </Label>

      {as === "select" ? (
        <Select {...register} id={register.name} aria-invalid={!!error}>
          {props.children}
        </Select>
      ) : (
        <Input
          {...register}
          id={register.name}
          type={props.type ?? "text"}
          placeholder={props.placeholder}
          disabled={props.disabled}
          aria-invalid={!!error}
        />
      )}

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
