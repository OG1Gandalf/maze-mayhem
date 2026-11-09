import type { NpcReply, Role } from '../shared/protocol';

const INTRO: Record<Role, string> = {
  MP: 'An MP corners you, flanked by aides. "Nobody passes my constituency for free."',
  BUSINESSMAN: 'A businessman in a shiny suit catches up, grinning. "Everything has a price, friend. Including this hallway."',
  MLA: 'A local MLA waves a stack of files in your face. "I could approve a shortcut... for a small consideration."',
  POLICE: 'A policeman grabs your collar and raises his lathi. "Papers! Or something better than papers."',
};

const STEP_ONE: Record<Role, string> = {
  MP: 'The MP taps his watch. "Make your opening offer."',
  BUSINESSMAN: '"Let\'s talk numbers," he says, rubbing his hands.',
  MLA: '"Opening offer? Think of the development fund."',
  POLICE: '"Well? How much is your freedom worth?"',
};

const REPLY: Record<Exclude<NpcReply, 'accept'>, Record<Role, string>> = {
  not_enough: {
    MP: '"Not enough. Close, but my aides need chai too."',
    BUSINESSMAN: '"Not enough. You\'re in the right neighbourhood, though."',
    MLA: '"Not enough. The files are heavy, you know."',
    POLICE: '"Not enough. My shift is long."',
  },
  too_much_to_ask: {
    MP: '"Too much to ask for that pittance!"',
    BUSINESSMAN: '"Too much to ask! Do I look like a charity?"',
    MLA: '"Too much to ask. That won\'t even cover the stamp."',
    POLICE: '"Too much to ask. Don\'t waste my time."',
  },
};

const FAR_TOO_LOW = 'Insulted, they cut the talk short. You lose a step.';

export function introLine(role: Role): string {
  return INTRO[role];
}

export function stepOneLine(role: Role): string {
  return STEP_ONE[role];
}

export function replyLine(role: Role, reply: Exclude<NpcReply, 'accept'>, farTooLow: boolean, finalStep: boolean): string {
  const parts = [REPLY[reply][role]];
  if (farTooLow) parts.push(FAR_TOO_LOW);
  if (finalStep) parts.push('Last chance: make your final offer.');
  return parts.join(' ');
}
