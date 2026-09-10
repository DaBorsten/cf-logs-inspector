export interface DqlError {
  message: string;
  start: number;
  end: number;
  hint?: string;
}

export class DqlSyntaxError extends Error {
  readonly start: number;
  readonly end: number;
  readonly hint: string | undefined;

  constructor(message: string, start: number, end: number, hint?: string) {
    super(message);
    this.name = 'DqlSyntaxError';
    this.start = start;
    this.end = end;
    this.hint = hint;
  }

  toJSON(): DqlError {
    return this.hint === undefined
      ? { message: this.message, start: this.start, end: this.end }
      : { message: this.message, start: this.start, end: this.end, hint: this.hint };
  }
}
