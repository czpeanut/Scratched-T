// Story state and narrative flags manager

export class StoryManager {
  public flags: Set<string> = new Set();
  public abilities: { sprint: boolean; doubleJump: boolean } = {
    sprint: false,
    doubleJump: false,
  };

  constructor(startingAbilities?: { sprint?: boolean }) {
    if (startingAbilities?.sprint) this.abilities.sprint = true;
  }

  setFlag(flag: string) {
    this.flags.add(flag);
  }

  hasFlag(flag: string): boolean {
    return this.flags.has(flag);
  }

  grantAbility(name: 'sprint') {
    this.abilities[name] = true;
    this.setFlag(`ability_${name}`);
  }

  canSprint(): boolean {
    return this.abilities.sprint;
  }
}
