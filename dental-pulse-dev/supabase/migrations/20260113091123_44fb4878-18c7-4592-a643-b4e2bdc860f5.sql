-- Create a simple test table to verify database connection
CREATE TABLE public.test_connection (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    message TEXT NOT NULL DEFAULT 'Hello from Supabase!',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS (good practice even for test tables)
ALTER TABLE public.test_connection ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read (for testing purposes)
CREATE POLICY "Allow public read access" 
ON public.test_connection 
FOR SELECT 
USING (true);

-- Insert a test row
INSERT INTO public.test_connection (message) VALUES ('Database connection successful!');