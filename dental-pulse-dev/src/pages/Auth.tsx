import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { z } from 'zod';
import { Mail, Lock, User, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import Swal from 'sweetalert2';
import { useAuth } from '@/hooks/useAuth';


const emailSchema = z.string().email('Please enter a valid email address');
const passwordSchema = z.string().min(6, 'Password must be at least 6 characters');
const nameSchema = z.string().min(2, 'Name must be at least 2 characters');

const Auth = () => {
  const navigate = useNavigate();
  const { signIn, signUp, isAuthenticated, loading } = useAuth();
  
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [activeTab, setActiveTab] = useState<'login' | 'signup'>('login');
  
  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string; name?: string }>({});

  // Note: Redirect after auth is handled by ProtectedRoute
  // We only prevent showing the auth page if already authenticated
  useEffect(() => {
    if (!loading && isAuthenticated) {
      // ProtectedRoute will handle redirect to /onboarding or / based on profile
      navigate('/');
    }
  }, [isAuthenticated, loading, navigate]);

  const validateForm = () => {
    const newErrors: { email?: string; password?: string; name?: string } = {};
    
    try {
      emailSchema.parse(email);
    } catch (e) {
      if (e instanceof z.ZodError) {
        newErrors.email = e.errors[0].message;
      }
    }
    
    try {
      passwordSchema.parse(password);
    } catch (e) {
      if (e instanceof z.ZodError) {
        newErrors.password = e.errors[0].message;
      }
    }
    
    if (activeTab === 'signup') {
      try {
        nameSchema.parse(fullName);
      } catch (e) {
        if (e instanceof z.ZodError) {
          newErrors.name = e.errors[0].message;
        }
      }
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    
    setIsLoading(true);
    let result: { error: any };
    try {
      result = await signIn(email, password);
    } catch (err: any) {
      setIsLoading(false);
      toast.error('Connection failed', {
        description: 'Unable to reach the server. Please check your internet connection and try again.',
      });
      return;
    }
    const { error } = result;

    if (error) {
      setIsLoading(false); // Only clear spinner on error
      const msg = error.message || '';
      const isCorsOrNetwork = msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('CORS');
      toast.error(isCorsOrNetwork ? 'Connection failed' : 'Sign in failed', {
        description: isCorsOrNetwork
          ? 'Unable to reach the server. Please check your internet connection or try accessing from localhost.'
          : msg === 'Invalid login credentials'
            ? 'Invalid email or password. Please try again.'
            : msg,
      });
    } else {
      toast.success('Welcome back!', {
        description: 'You have successfully signed in.',
      });
      // Keep isLoading=true — shows "Signing in..." until the useEffect
      // detects isAuthenticated=true and navigates away
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    
    setIsLoading(true);
    let result: { error: any };
    try {
      result = await signUp(email, password, fullName);
    } catch (err: any) {
      setIsLoading(false);
      toast.error('Connection failed', {
        description: 'Unable to reach the server. Please check your internet connection and try again.',
      });
      return;
    }
    setIsLoading(false);
    const { error } = result;

    if (error) {
      if (error.message.includes('already registered')) {
        toast.error('Account exists', {
          description: 'An account with this email already exists. Please sign in instead.',
        });
        setActiveTab('login');
      } else {
        toast.error('Sign up failed', {
          description: error.message,
        });
      }
    } else {
      // Show SweetAlert with OK button - only closes when user clicks OK
      await Swal.fire({
        title: 'Account Successfully Created!',
        text: 'Welcome to DentPulse Enterprise. Please check your email to complete the organization setup process.',
        icon: 'success',
        confirmButtonText: 'OK',
        confirmButtonColor: 'hsl(244, 48%, 25%)',
        allowOutsideClick: false,
        allowEscapeKey: false,
      });
      // Navigate to root - ProtectedRoute will redirect to /onboarding for new users
      navigate('/');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
      <Helmet>
        <title>DentPulse Enterprise</title>
        <meta name="description" content="Secure login and account creation for Dental Pulse dental practice management platform." />
      </Helmet>
      <div className="w-full max-w-md space-y-8">
        {/* Logo */}
        <div className="text-center space-y-4">
          <div className="w-35 h-25 flex items-center justify-center mx-auto">
            {/* <Sparkles className="w-8 h-8 text-primary-foreground" /> */}
            {/* <img src="/icons/dp-white.png" alt="DentPulse Enterprise" className="w-15 h-15" /> */}
            <img
  src="https://fpqesehkowpvxraommsc.supabase.co/storage/v1/object/public/site-logo/DentPulseLogoDark.png"
  alt="DentPulse Enterprise"
 className='w-40 h-15'
/>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">DentPulse Enterprise</h1>
            <p className="text-muted-foreground">Enterprise Financial Dashboard</p>
          </div>
        </div>

        {/* Auth Card */}
        <Card className="border-border/50 shadow-xl">
          <CardHeader className="space-y-1 text-center">
            <CardTitle className="text-xl">
              {activeTab === 'login' ? 'Welcome back' : 'Create an account'}
            </CardTitle>
            <CardDescription>
              {activeTab === 'login' 
                ? 'Sign in to access your dashboard' 
                : 'Start your free trial today'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={(v) => {
              setActiveTab(v as 'login' | 'signup');
              setErrors({});
              setEmail('');
              setPassword('');
              setFullName('');
            }}>
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="login">Sign In</TabsTrigger>
                <TabsTrigger value="signup">Sign Up</TabsTrigger>
              </TabsList>
              
              <TabsContent value="login">
                <form onSubmit={handleSignIn} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Email *</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="login-email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          if (errors.email) setErrors(prev => ({ ...prev, email: undefined }));
                        }}
                        className="pl-10"
                      />
                    </div>
                    {errors.email && (
                      <p className="text-xs text-destructive">{errors.email}</p>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Password *</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="login-password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          if (errors.password) setErrors(prev => ({ ...prev, password: undefined }));
                        }}
                        className="pl-10 pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {errors.password && (
                      <p className="text-xs text-destructive">{errors.password}</p>
                    )}
                  </div>
                  
                  <Button type="submit" className="w-full gap-2" disabled={isLoading}>
                    {isLoading ? 'Signing in...' : 'Sign In'}
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </form>
              </TabsContent>
              
              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-name">Full Name <span className="text-destructive">*</span></Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="signup-name"
                        type="text"
                        placeholder="John Smith"
                        value={fullName}
                        onChange={(e) => {
                          setFullName(e.target.value);
                          if (errors.name) setErrors(prev => ({ ...prev, name: undefined }));
                        }}
                        className="pl-10"
                      />
                    </div>
                    {errors.name && (
                      <p className="text-xs text-destructive">{errors.name}</p>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email *</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="signup-email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          if (errors.email) setErrors(prev => ({ ...prev, email: undefined }));
                        }}
                        className="pl-10"
                      />
                    </div>
                    {errors.email && (
                      <p className="text-xs text-destructive">{errors.email}</p>
                    )}
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password *</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="signup-password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          if (errors.password) setErrors(prev => ({ ...prev, password: undefined }));
                        }}
                        className="pl-10 pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {errors.password && (
                      <p className="text-xs text-destructive">{errors.password}</p>
                    )}
                  </div>
                  
                  <Button type="submit" className="w-full gap-2" disabled={isLoading}>
                    {isLoading ? 'Creating account...' : 'Create Account'}
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </form>
                <p className="text-center text-sm text-muted-foreground mt-4">
                  By continuing, you agree to our <a href="javascript:void(0)" className="text-blue-500 hover:underline">Terms of Service</a> and <a href="javascript:void(0)" className="text-blue-500 hover:underline">Privacy Policy</a>.
                </p>
              </TabsContent>
          </Tabs>
          </CardContent>
        </Card>

        {/* <p className="text-center text-sm text-muted-foreground">
          By continuing, you agree to our <a href="javascript:void(0)" className="text-blue-500 hover:underline">Terms of Service</a> and <a href="javascript:void(0)" className="text-blue-500 hover:underline">Privacy Policy</a>.
        </p> */}
      </div>
    </div>
  );
};

export default Auth;
