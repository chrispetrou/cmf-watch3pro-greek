// Languages offered in the app. Keep in step with tools/languages.py and the README table.
export type Language = {
  id: string; // the --lang id in tools/languages.py
  code: string; // BCP 47, for the lang attribute
  name: string; // native name
  en: string;
  el?: string; // the name in Greek, for the Greek page
  tested: boolean; // flashed and checked on a real watch
  sender: string;
  msg: string;
  date: string;
};

export const LANGUAGES: Language[] = [
  { id: "greek", code: "el", name: "Ελληνικά", en: "Greek", el: "Ελληνικά", tested: true,
    sender: "Μαρία", msg: "Φτάνω σε 10 λεπτά, κράτα μου θέση!", date: "Δευτέρα 16 Νοε" },
  { id: "georgian", code: "ka", name: "ქართული", en: "Georgian", el: "Γεωργιανά", tested: true,
    sender: "ნინო", msg: "ხვალ 10 საათზე შევხვდეთ?", date: "ორშაბათი, 16 ნოემბერი" },
  { id: "armenian", code: "hy", name: "Հայերեն", en: "Armenian", el: "Αρμενικά", tested: true,
    sender: "Արամ", msg: "Շնորհակալություն, երեկոյան կզանգեմ։", date: "Երկուշաբթի, 16 նոյեմբերի" },
];

// ?demo=many: placeholder entries to check that the picker scales. They can't be built.
const PLACEHOLDERS: [string, string, string][] = [
  ["uk", "Українська", "Ukrainian"], ["bg", "Български", "Bulgarian"],
  ["sr", "Српски", "Serbian"], ["vi", "Tiếng Việt", "Vietnamese"], ["mn", "Монгол", "Mongolian"],
  ["kk", "Қазақша", "Kazakh"], ["is", "Íslenska", "Icelandic"], ["ro", "Română", "Romanian"],
];
export const demoLanguages = (): Language[] => [
  ...LANGUAGES,
  ...PLACEHOLDERS.map(([code, name, en]) => ({ id: en.toLowerCase(), code, name, en, tested: false, sender: "", msg: "", date: "" })),
];

/** A preview card for the emoji option, shown on the watch next to the languages' cards. */
export const EMOJI_PREVIEW: Language = {
  id: "emoji", code: "en", name: "Emoji", en: "Emoji", tested: true,
  sender: "Alex", msg: "🎉🔥😍 See you at 8!", date: "Mon 16 Nov",
};
