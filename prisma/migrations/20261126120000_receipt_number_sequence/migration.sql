-- Payment receipts (RCT-...) get their own numbering so they never create gaps in the consecutive INV-... invoice numbers.
CREATE SEQUENCE IF NOT EXISTS receipt_number_seq START 1;
