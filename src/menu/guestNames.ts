// The name given to whoever plays without typing one: a war word in the page's language and three
// digits ("Sargento742", "Sniper318", "Cañón905"), easier to tell apart than numbers alone.
import { lang, type Lang } from '../i18n';

const WORDS: Record<Exclude<Lang, 'pt-pt' | 'es-es'>, readonly string[]> = {
  en: [
    'Soldier', 'Sergeant', 'Corporal', 'Private', 'Rookie', 'Sniper', 'Commando', 'Lieutenant',
    'Captain', 'Major', 'Colonel', 'Gunner', 'Grenadier', 'Scout', 'Sentinel', 'Warrior',
    'Mercenary', 'Paratrooper', 'Marine', 'Ranger', 'Veteran', 'Trooper', 'Gladiator', 'Tank',
    'Cannon', 'Bazooka', 'Trench', 'Ambush', 'Raider', 'Bomber', 'Spy', 'Commander',
  ],
  pt: [
    'Soldado', 'Sargento', 'Cabo', 'Recruta', 'Atirador', 'Comando', 'Tenente', 'Capitão',
    'Major', 'Coronel', 'Artilheiro', 'Granadeiro', 'Batedor', 'Sentinela', 'Guerreiro', 'Mercenário',
    'Paraquedista', 'Fuzileiro', 'Combatente', 'Veterano', 'Patrulheiro', 'Gladiador', 'Tanque', 'Canhão',
    'Bazuca', 'Trincheira', 'Emboscada', 'Blindado', 'Míssil', 'Bombardeiro', 'Espião', 'Comandante',
  ],
  es: [
    'Soldado', 'Sargento', 'Cabo', 'Recluta', 'Tirador', 'Comando', 'Teniente', 'Capitán',
    'Mayor', 'Coronel', 'Artillero', 'Granadero', 'Explorador', 'Centinela', 'Guerrero', 'Mercenario',
    'Paracaidista', 'Infante', 'Combatiente', 'Veterano', 'Patrullero', 'Gladiador', 'Tanque', 'Cañón',
    'Bazuca', 'Trinchera', 'Emboscada', 'Blindado', 'Misil', 'Bombardero', 'Espía', 'Comandante',
  ],
  fr: [
    'Soldat', 'Sergent', 'Caporal', 'Recrue', 'Tireur', 'Commando', 'Lieutenant', 'Capitaine',
    'Major', 'Colonel', 'Artilleur', 'Grenadier', 'Éclaireur', 'Sentinelle', 'Guerrier', 'Mercenaire',
    'Parachutiste', 'Fusilier', 'Combattant', 'Vétéran', 'Patrouilleur', 'Gladiateur', 'Tank', 'Canon',
    'Bazooka', 'Tranchée', 'Embuscade', 'Blindé', 'Missile', 'Bombardier', 'Espion', 'Commandant',
  ],
  de: [
    'Soldat', 'Feldwebel', 'Gefreiter', 'Rekrut', 'Schütze', 'Kommando', 'Leutnant', 'Hauptmann',
    'Major', 'Oberst', 'Kanonier', 'Grenadier', 'Späher', 'Wache', 'Krieger', 'Söldner',
    'Fallschirmjäger', 'Füsilier', 'Kämpfer', 'Veteran', 'Patrouille', 'Gladiator', 'Panzer', 'Kanone',
    'Bazooka', 'Graben', 'Hinterhalt', 'Rakete', 'Bomber', 'Spion', 'Kommandant', 'Jäger',
  ],
  it: [
    'Soldato', 'Sergente', 'Caporale', 'Recluta', 'Tiratore', 'Commando', 'Tenente', 'Capitano',
    'Maggiore', 'Colonnello', 'Artigliere', 'Granatiere', 'Esploratore', 'Sentinella', 'Guerriero', 'Mercenario',
    'Paracadutista', 'Fuciliere', 'Combattente', 'Veterano', 'Pattuglia', 'Gladiatore', 'Carrarmato', 'Cannone',
    'Bazooka', 'Trincea', 'Imboscata', 'Corazzato', 'Missile', 'Bombardiere', 'Spia', 'Comandante',
  ],
  pl: ['Żołnierz', 'Sierżant', 'Kapral', 'Rekrut', 'Strzelec', 'Komandos', 'Porucznik', 'Kapitan', 'Major', 'Pułkownik', 'Kanonier', 'Grenadier', 'Zwiadowca', 'Wartownik', 'Wojownik', 'Najemnik', 'Spadochroniarz', 'Weteran', 'Gladiator', 'Czołg', 'Armata', 'Bazooka', 'Okop', 'Zasadzka', 'Rakieta', 'Bombowiec', 'Szpieg', 'Dowódca'],
  tr: ['Asker', 'Çavuş', 'Onbaşı', 'Acemi', 'Nişancı', 'Komando', 'Teğmen', 'Yüzbaşı', 'Binbaşı', 'Albay', 'Topçu', 'Bombacı', 'İzci', 'Nöbetçi', 'Savaşçı', 'Paralı', 'Paraşütçü', 'Gazi', 'Gladyatör', 'Tank', 'Top', 'Bazuka', 'Siper', 'Pusu', 'Füze', 'Casus', 'Komutan', 'Avcı'],
  ru: ['Солдат', 'Сержант', 'Капрал', 'Новобранец', 'Стрелок', 'Коммандос', 'Лейтенант', 'Капитан', 'Майор', 'Полковник', 'Артиллерист', 'Гренадер', 'Разведчик', 'Часовой', 'Воин', 'Наёмник', 'Десантник', 'Ветеран', 'Гладиатор', 'Танк', 'Пушка', 'Базука', 'Окоп', 'Засада', 'Ракета', 'Бомбер', 'Шпион', 'Командир'],
  uk: ['Солдат', 'Сержант', 'Капрал', 'Новобранець', 'Стрілець', 'Командос', 'Лейтенант', 'Капітан', 'Майор', 'Полковник', 'Артилерист', 'Гренадер', 'Розвідник', 'Вартовий', 'Воїн', 'Найманець', 'Десантник', 'Ветеран', 'Гладіатор', 'Танк', 'Гармата', 'Базука', 'Окоп', 'Засідка', 'Ракета', 'Бомбер', 'Шпигун', 'Командир'],
  ja: ['兵士', '軍曹', '伍長', '新兵', '狙撃手', 'コマンドー', '中尉', '大尉', '少佐', '大佐', '砲手', '擲弾兵', '斥候', '歩哨', '戦士', '傭兵', '空挺兵', '古参兵', '剣闘士', '戦車', '大砲', 'バズーカ', '塹壕', '伏兵', 'ミサイル', '爆撃機', 'スパイ', '司令官'],
  ko: ['병사', '병장', '상병', '신병', '저격수', '특공대', '중위', '대위', '소령', '대령', '포병', '척탄병', '정찰병', '보초', '전사', '용병', '공수병', '베테랑', '검투사', '탱크', '대포', '바주카', '참호', '매복', '미사일', '폭격기', '스파이', '사령관'],
  zh: ['士兵', '中士', '下士', '新兵', '狙击手', '突击队', '中尉', '上尉', '少校', '上校', '炮手', '掷弹兵', '侦察兵', '哨兵', '战士', '佣兵', '伞兵', '老兵', '角斗士', '坦克', '大炮', '火箭筒', '战壕', '伏兵', '导弹', '轰炸机', '间谍', '指挥官'],
  'zh-tw': ['士兵', '中士', '下士', '新兵', '狙擊手', '突擊隊', '中尉', '上尉', '少校', '上校', '砲手', '擲彈兵', '偵察兵', '哨兵', '戰士', '傭兵', '傘兵', '老兵', '角鬥士', '坦克', '大砲', '火箭筒', '戰壕', '伏兵', '飛彈', '轟炸機', '間諜', '指揮官'],
};

export function randomGuestName(): string {
  // (Portugal's and Spain's: the same words as Brazil's and Latin America's)
  const l = lang();
  const words = WORDS[l === 'pt-pt' ? 'pt' : l === 'es-es' ? 'es' : l];
  return `${words[Math.floor(Math.random() * words.length)]}${100 + Math.floor(Math.random() * 900)}`;
}

/** The old generated names ("Orb482"): replaced by a new one on the next match. */
export function isOldGeneratedName(name: string): boolean {
  return /^Orb\d{3}$/.test(name);
}
