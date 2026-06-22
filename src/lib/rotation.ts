export type RotationGroup = {
  id: string;
  name: string;
  pageIds: string[]; // ordenado
};

export type RotationInput = {
  posts: { rowIndex: number; mediaFileName: string; content: string; commentLink: string | null; scheduledAt: string | null }[];
  groups: RotationGroup[];
  startDate: Date; // BR local interpretado como Date UTC
  intervalMinutes: number;
  useSpreadsheetDates: boolean;
  rotationMode: "group" | "page";
  distribution: "mass" | "distribution";
};

export type RotationSlot = {
  hourIndex: number;
  pageId: string;
  groupId: string;
  groupIndex: number;
  pageIndex: number; // global, achatado
  mediaIndex: number;
  scheduledAt: string; // ISO UTC
};

export type RotationValidation = {
  errors: string[];
  warnings: string[];
};

export function validateRotation(input: Pick<RotationInput, "posts" | "groups" | "rotationMode">): RotationValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (input.groups.length === 0) errors.push("Selecione ao menos um grupo de páginas.");
  if (input.groups.length === 1) warnings.push("Rotação faz mais sentido com 2 ou mais grupos.");
  const totalPages = input.groups.reduce((s, g) => s + g.pageIds.length, 0);
  const totalMedias = input.posts.length;
  if (totalMedias === 0) errors.push("Importe pelo menos um post.");
  if (input.rotationMode === "group" && totalMedias < input.groups.length) {
    warnings.push("Há menos mídias que grupos — haverá repetição entre grupos no mesmo horário.");
  }
  if (input.rotationMode === "page" && totalMedias < totalPages) {
    warnings.push("Há menos mídias que páginas — haverá repetição entre páginas no mesmo horário.");
  }
  return { errors, warnings };
}

function addMinutes(d: Date, m: number): Date {
  return new Date(d.getTime() + m * 60000);
}

export function buildRotation(input: RotationInput): RotationSlot[] {
  const { posts, groups, startDate, intervalMinutes, useSpreadsheetDates, rotationMode, distribution } = input;
  const slots: RotationSlot[] = [];
  const totalMedias = posts.length;
  if (totalMedias === 0 || groups.length === 0) return slots;

  // achatado
  const flatPages: { pageId: string; groupId: string; groupIndex: number; pageIndex: number }[] = [];
  groups.forEach((g, gi) => g.pageIds.forEach((pid) => {
    flatPages.push({ pageId: pid, groupId: g.id, groupIndex: gi, pageIndex: flatPages.length });
  }));

  // "mass": todas as páginas recebem todos os posts, sem rotação
  if (distribution === "mass") {
    for (let h = 0; h < totalMedias; h++) {
      const base = useSpreadsheetDates && posts[h].scheduledAt
        ? new Date(posts[h].scheduledAt!)
        : addMinutes(startDate, h * intervalMinutes);
      flatPages.forEach((p, idx) => {
        const stagger = Math.floor(idx / 10) * 2;
        slots.push({
          hourIndex: h,
          pageId: p.pageId,
          groupId: p.groupId,
          groupIndex: p.groupIndex,
          pageIndex: p.pageIndex,
          mediaIndex: h,
          scheduledAt: addMinutes(base, stagger).toISOString(),
        });
      });
    }
    return slots;
  }

  // distribution
  for (let h = 0; h < totalMedias; h++) {
    const base = useSpreadsheetDates && posts[h].scheduledAt
      ? new Date(posts[h].scheduledAt!)
      : addMinutes(startDate, h * intervalMinutes);

    if (rotationMode === "group") {
      groups.forEach((g, gi) => {
        const mediaIndex = (h + gi) % totalMedias;
        g.pageIds.forEach((pid) => {
          const flat = flatPages.find((f) => f.pageId === pid && f.groupIndex === gi)!;
          const stagger = Math.floor(flat.pageIndex / 10) * 2;
          slots.push({
            hourIndex: h,
            pageId: pid,
            groupId: g.id,
            groupIndex: gi,
            pageIndex: flat.pageIndex,
            mediaIndex,
            scheduledAt: addMinutes(base, stagger).toISOString(),
          });
        });
      });
    } else {
      // page mode
      flatPages.forEach((p) => {
        const mediaIndex = (h + p.pageIndex) % totalMedias;
        const stagger = Math.floor(p.pageIndex / 10) * 2;
        slots.push({
          hourIndex: h,
          pageId: p.pageId,
          groupId: p.groupId,
          groupIndex: p.groupIndex,
          pageIndex: p.pageIndex,
          mediaIndex,
          scheduledAt: addMinutes(base, stagger).toISOString(),
        });
      });
    }
  }

  return slots;
}
