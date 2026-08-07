export function getConversationDisplayTitle(conversation, currentUserId, employeeLookup = {}) {
  if (conversation?.title) return conversation.title;

  const otherMembers = (conversation?.members || []).filter((member) => Number(member?.id) !== Number(currentUserId));
  const names = otherMembers
    .map((member) => {
      const fallback = member?.fullName || member?.name || member?.email || "";
      if (fallback) return fallback;
      const employee = employeeLookup[Number(member?.id)];
      return employee?.fullName || "موظف";
    })
    .filter(Boolean);

  if (names.length) return names.join(" • ");
  return "محادثة جديدة";
}
