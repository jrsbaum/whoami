export type AuthMode = "login" | "create";
export type AppScreen = "auth" | "confirm" | "onboarding" | "game";

export type NextScreenPlayer = {
  name: string;
  farmName: string;
  specialization: "fruits" | "vegetables" | "dinosaurs" | null;
  homeRegionId?: string | null;
  plot?: { id?: string } | null;
};

export const isProfileComplete = (player: NextScreenPlayer): boolean =>
  Boolean(player.specialization && player.farmName.trim().length >= 2 && player.name.trim().length >= 2 && (player.homeRegionId || player.plot?.id));

export const nextScreenAfterAuth = (justRegistered: boolean, player: NextScreenPlayer): AppScreen => {
  if (justRegistered) return "confirm";
  return isProfileComplete(player) ? "game" : "onboarding";
};
