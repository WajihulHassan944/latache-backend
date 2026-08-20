-- Support efficient automatic expiry of participant settlement proposals.
CREATE INDEX IF NOT EXISTS "dispute_resolutions_status_response_due_idx"
ON "DisputeResolutions"("status", "proposalResponseDueAt");
