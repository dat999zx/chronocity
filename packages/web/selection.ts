// What the user picked: a file's building or a folder's district (an index into model.files / layout.districts).
export type Selection = { kind: 'file'; index: number } | { kind: 'district'; index: number }
