export interface DateFieldProps {
  label: string;
  /** AAAA-MM-JJ */
  value?: string;
  onChange: (iso: string | undefined) => void;
  minimumDate?: string;
  error?: string | null;
  placeholder?: string;
  clearable?: boolean;
}
