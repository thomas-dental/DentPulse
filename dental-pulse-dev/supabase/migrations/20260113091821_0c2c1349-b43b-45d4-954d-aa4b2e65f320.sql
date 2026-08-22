-- Drop the test table
DROP POLICY IF EXISTS "Allow public read access" ON public.test_connection;
DROP TABLE IF EXISTS public.test_connection;