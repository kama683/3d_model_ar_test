const DICTIONARY: ReadonlyArray<[RegExp, string]> = [
  [/idle|stand|breath/i, 'Ожидание'],
  [/dance|dancing/i, 'Танец'],
  [/walk/i, 'Ходьба'],
  [/run|sprint/i, 'Бег'],
  [/jump/i, 'Прыжок'],
  [/wave|hello|greet/i, 'Привет'],
  [/sit/i, 'Сидит'],
  [/fly|flying/i, 'Полёт'],
  [/attack|punch|kick/i, 'Атака'],
  [/death|die/i, 'Падение'],
];

/** Подпись для кнопки анимации: русское название, если узнаём ключевое слово, иначе исходное имя. */
export function clipLabel(name: string): string {
  const match = DICTIONARY.find(([re]) => re.test(name));
  const clean = name.replace(/^.*\|/, '').replace(/[_-]+/g, ' ').trim() || name;
  return match ? match[1] : clean;
}

/** Какую анимацию запускать по умолчанию: «idle», если есть, иначе первую. */
export function pickDefaultClip(names: string[]): string | null {
  return names.find((n) => /idle/i.test(n)) ?? names[0] ?? null;
}
