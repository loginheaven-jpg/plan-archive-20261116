import type { Actor, Person } from "../domain/types";
import { actorWithSaintAccess } from "./saint-session";

/**
 * Server-only request evidence, never an Actor flag, claim, symbol or wire token.
 * Saint keeps the eligibility boolean on the exact centrally validated Person;
 * this module keeps that Person on only the exact server-created Actor. Neither
 * WeakMap nor an eligibility getter/setter is exported. A spread, structuredClone,
 * JSON round-trip, legacy seal or client-supplied role/source cannot carry proof.
 * Requests get new Saint Persons (only the exact Request is deduplicated), so
 * central downgrade/revocation is effective on the next request, without DB grants.
 */
const actorEvidence = new WeakMap<Actor, Person>();

/** Called by auth after central authentication and the manual DB role lookup. */
export function actorWithAutomaticAccess(person: Person, manual: Actor): Actor {
  const actor = actorWithSaintAccess(person, manual);
  // The Saint composer itself validates Person object identity AND subject ID;
  // passing a forged/copy Person here cannot mint automatic access evidence.
  actorEvidence.set(actor, person);
  return actor;
}

/** Called by writeActor with the LOCKED, freshly re-read manual DB role. */
export function refreshAutomaticAccess(actor: Actor, manual: Actor): Actor {
  const person = actorEvidence.get(actor);
  if (!person || actor.id !== manual.id) return actorWithSaintAccess(null, manual);
  return actorWithAutomaticAccess(person, manual);
}
