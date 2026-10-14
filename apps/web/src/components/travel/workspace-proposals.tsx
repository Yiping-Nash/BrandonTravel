import { ProposalList } from "./proposal-list";
import { travelApi as api } from "./api";
import type { TravelProposal } from "@open-sunsama/types";
import type { TravelWorkspace } from "./use-travel-workspace";
export function WorkspaceProposals({ state }: { state: TravelWorkspace }) {
  const {
    trip,
    pendingTotal,
    proposals,
    historyTotal,
    pendingCursor,
    busy,
    act,
    setProposals,
    setPendingCursor,
  } = state;
  if (!trip) return null;
  return (
    <ProposalList
      key={trip.id}
      pendingTotal={pendingTotal}
      trip={trip}
      proposals={proposals}
      historyTotal={historyTotal}
      pendingCursor={pendingCursor}
      busy={busy}
      onPendingMore={async () => {
        if (pendingCursor === null) return;
        const page = await api<{
          items: TravelProposal[];
          nextCursor: number | null;
        }>(
          `/trips/${trip.id}/proposals?status=pending&limit=50&cursor=${pendingCursor}`,
        );
        setProposals((old) => [
          ...old,
          ...page.items.filter((p) => !old.some((o) => o.id === p.id)),
        ]);
        setPendingCursor(page.nextCursor);
      }}
      onAction={async (id, action) => {
        await act(
          () => api(`/proposals/${id}/${action}`, "POST"),
          action === "confirm" ? "已保存" : "已拒绝",
        );
      }}
    />
  );
}
