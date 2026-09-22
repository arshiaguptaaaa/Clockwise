const PALETTE = [
  { bg: "#F4E3D3", text: "#8B4E2B" },
  { bg: "#DCE3EC", text: "#35507A" },
  { bg: "#EBDCEA", text: "#6B3F68" },
  { bg: "#F5E7C6", text: "#8A6A1D" },
  { bg: "#E1EAE0", text: "#43613F" },
  { bg: "#F3DEE1", text: "#8C4058" },
];

export function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash + name.charCodeAt(i)) % PALETTE.length;
  }
  return PALETTE[hash];
}
