-- Normalize existing emails to lowercase (emails are now case-insensitive).
UPDATE "User" SET email = lower(email);
UPDATE "WorkspaceInvite" SET email = lower(email);
