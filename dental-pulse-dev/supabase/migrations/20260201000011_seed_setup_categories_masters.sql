-- Seed CategoryRangeMaster (reference: db-dentpulse 00 CategoryRangeMaster_Data.sql)
INSERT INTO public.category_range_master (id, range_order, code, name, range_group, range_sub_group) VALUES
(1, 101, 'CFO', 'CFO', 'CASH FLOW FROM OPERATIONS', 'Income'),
(2, 411, 'Compliance', 'Compliance', 'TAX Paid', 'Payment'),
(3, 201, 'CFI', 'CFI', 'CASH FLOW FROM INVESTING ACTIVITIES', 'Income'),
(4, 211, 'CFIPayment', 'CFI Payment', 'CASH FLOW FROM INVESTING ACTIVITIES', 'Payment'),
(5, 301, 'CFF', 'CFF', 'CASH FLOW FROM FINANCING ACTIVITIES', 'Income'),
(6, 311, 'CFFPayment', 'CFF Payment', 'CASH FLOW FROM FINANCING ACTIVITIES', 'Payment'),
(7, 601, 'IntraAccountReceipt', 'Intra Account Receipt', 'Intra Account Transfers', 'Income'),
(8, 611, 'IntraAccountPayment', 'Intra Account Payment', 'Intra Account Transfers', 'Payment'),
(9, 111, 'Direct Costs', 'Direct Costs', 'CASH FLOW FROM OPERATIONS', 'Payment'),
(10, 112, 'OverHeads', 'Over Heads', 'CASH FLOW FROM OPERATIONS', 'Payment'),
(11, 501, 'IntraCompanyReceipt', 'Intra Company Receipt', 'Intra Company Transfers', 'Income'),
(12, 511, 'IntraCompanyPayment', 'Intra Company Payment', 'Intra Company Transfers', 'Payment'),
(13, 401, 'TaxRefund', 'Tax Refund', 'Tax Refund', 'Income')
ON CONFLICT (id) DO NOTHING;

-- Seed CategoryWishListMaster (reference: db-dentpulse 00 CategoryWishListMaster_Data.sql)
-- SectorId 0 = generic, 10 = Dental (be-dentpulse Enums.Sector.Dental = 10)
INSERT INTO public.category_wish_list_master (id, range_order, name, category_wish_list, sector_id) VALUES
(1, 1, 'PeopleSalaries', 'Fixed Cost', 0),
(2, 2, 'Performers/productsBoughtToSold', 'Performers/products bought to sold', 0),
(3, 3, 'Marketing', 'Marketing', 0),
(4, 4, 'DebtAsAPer', 'Debt as a Per', 0),
(5, 5, 'Premises', 'Premises', 0),
(6, 6, 'OneOffExpense', 'One Off Expense', 0),
(7, 1, 'OtherFixedCosts', 'OTHER FIXED COSTS', 10),
(8, 2, 'DENTIST', 'DENTIST', 10),
(9, 5, 'Staff', 'STAFF', 10),
(10, 4, 'DebtAsAPer', 'Debt as a Per', 10),
(11, 3, 'LabAndMaterial', 'LAB + MATERIAL', 10),
(12, 6, 'OneOffExpense', 'One Off Expense', 10),
(13, 7, 'Advertising', 'Advertising', 10)
ON CONFLICT (id) DO NOTHING;
