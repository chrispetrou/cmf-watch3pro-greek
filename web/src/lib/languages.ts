// Languages offered in the app. Keep in step with tools/languages.py and the README table.
export type Language = {
  id: string; // the --lang id in tools/languages.py
  code: string; // BCP 47, for the lang attribute
  name: string; // native name
  en: string;
  tested: boolean; // flashed and checked on a real watch
  sender: string;
  msg: string;
  date: string;
};

export const LANGUAGES: Language[] = [
  { id: "greek", code: "el", name: "Ελληνικά", en: "Greek", tested: true,
    sender: "Μαρία", msg: "Φτάνω σε 10 λεπτά, κράτα μου θέση!", date: "Δευτέρα 16 Νοε" },
  { id: "georgian", code: "ka", name: "ქართული", en: "Georgian", tested: false,
    sender: "ნინო", msg: "ხვალ 10 საათზე შევხვდეთ?", date: "ორშაბათი, 16 ნოემბერი" },
];

// ?demo=many: placeholder entries to check that the picker scales. They can't be built.
const PLACEHOLDERS: [string, string, string][] = [
  ["hy", "Հայերեն", "Armenian"], ["uk", "Українська", "Ukrainian"], ["bg", "Български", "Bulgarian"],
  ["sr", "Српски", "Serbian"], ["vi", "Tiếng Việt", "Vietnamese"], ["mn", "Монгол", "Mongolian"],
  ["kk", "Қазақша", "Kazakh"], ["is", "Íslenska", "Icelandic"], ["ro", "Română", "Romanian"],
];
export const demoLanguages = (): Language[] => [
  ...LANGUAGES,
  ...PLACEHOLDERS.map(([code, name, en]) => ({ id: en.toLowerCase(), code, name, en, tested: false, sender: "", msg: "", date: "" })),
];
