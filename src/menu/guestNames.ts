// The name given to whoever plays without typing one: a war word in the page's language and three
// digits ("Sargento742", "Sniper318", "Cañón905"), easier to tell apart than numbers alone.
import { lang, type Lang } from '../i18n';

const WORDS: Record<Lang, readonly string[]> = {
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
};

export function randomGuestName(): string {
  const words = WORDS[lang()];
  return `${words[Math.floor(Math.random() * words.length)]}${100 + Math.floor(Math.random() * 900)}`;
}

/** The old generated names ("Orb482"): replaced by a new one on the next match. */
export function isOldGeneratedName(name: string): boolean {
  return /^Orb\d{3}$/.test(name);
}
