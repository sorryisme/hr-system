export type TagResult =
  | { kind: 'success'; label: string; time: string }
  | { kind: 'error'; message: string }
