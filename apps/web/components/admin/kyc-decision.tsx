"use client";

import { decideKycAction } from "@/lib/actions/admin";
import { DecisionForm } from "./decision-form";

export function KycDecision({ submissionId }: { submissionId: string }) {
  return (
    <DecisionForm
      approveLabel="Approve identity"
      rejectLabel="Reject"
      noteLabel="Note to the seller (required to reject: what to fix)"
      onDecide={(approve, note) => decideKycAction(submissionId, approve, note)}
    />
  );
}
