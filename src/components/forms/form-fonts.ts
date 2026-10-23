export type FormFontOption = {
  family: string;
  source: "Bundled" | "Google" | "System";
};

const googleFamilies = [
  "ABeeZee",
  "Abril Fatface",
  "Anton",
  "Archivo",
  "Barlow",
  "Bebas Neue",
  "Cabin",
  "Comfortaa",
  "Cormorant Garamond",
  "Crimson Pro",
  "DM Sans",
  "Fira Sans",
  "IBM Plex Sans",
  "IBM Plex Serif",
  "Inconsolata",
  "Inter",
  "Josefin Sans",
  "Karla",
  "Lato",
  "Lexend",
  "Libre Baskerville",
  "Libre Franklin",
  "Lora",
  "Manrope",
  "Merriweather",
  "Montserrat",
  "Mulish",
  "Noto Sans",
  "Noto Serif",
  "Nunito",
  "Open Sans",
  "Oswald",
  "Outfit",
  "Playfair Display",
  "Plus Jakarta Sans",
  "Poppins",
  "PT Sans",
  "PT Serif",
  "Quicksand",
  "Raleway",
  "Roboto",
  "Roboto Mono",
  "Rubik",
  "Sora",
  "Source Sans 3",
  "Space Grotesk",
  "Space Mono",
  "Ubuntu",
  "Urbanist",
  "Work Sans",
] as const;

const systemFamilies = [
  "Arial",
  "Courier New",
  "Georgia",
  "Helvetica",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
] as const;

export const FORM_FONT_OPTIONS: FormFontOption[] = [
  ...googleFamilies.map((family) => ({
    family,
    source: family === "Inter" ? ("Bundled" as const) : ("Google" as const),
  })),
  ...systemFamilies.map((family) => ({
    family,
    source: "System" as const,
  })),
].sort((left, right) => left.family.localeCompare(right.family));

const googleFamilySet = new Set<string>(googleFamilies);
const bundledFamilySet = new Set(["Inter"]);

export function ensureFormFontLoaded(fontFamily: string) {
  if (
    typeof document === "undefined" ||
    bundledFamilySet.has(fontFamily) ||
    !googleFamilySet.has(fontFamily)
  ) {
    return;
  }

  const id = `maxform-font-${fontFamily
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}`;
  if (document.getElementById(id)) return;

  const family = encodeURIComponent(fontFamily).replace(/%20/g, "+");
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${family}:wght@300;400;500;600;700;800&display=swap`;
  document.head.appendChild(link);
}
