import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ImageUpload } from '@/components/ui/image-upload';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { User, Mail, Save, ArrowLeft, Bell, Globe, Palette, Lock, Eye, EyeOff } from 'lucide-react';

export default function Profile() {
  const navigate = useNavigate();
  const { user, profile, updateProfile, loading: authLoading } = useAuth();
  
  const [fullName, setFullName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  // Password change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  
  // Preferences
  const [preferences, setPreferences] = useState({
    emailNotifications: true,
    weeklyDigest: true,
    theme: 'system',
    language: 'en-GB',
  });

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || '');
      setAvatarUrl(profile.avatar_url);
    }
  }, [profile]);

  const handleAvatarChange = (url: string | null) => {
    setAvatarUrl(url);
  };

  const handlePasswordChange = async () => {
    if (!user?.email) return;
    
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match', {
        description: 'Please make sure your new passwords match.',
      });
      return;
    }

    if (newPassword.length < 6) {
      toast.error('Password too short', {
        description: 'Password must be at least 6 characters long.',
      });
      return;
    }
    
    setIsChangingPassword(true);
    
    // First verify current password by attempting to sign in
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    
    if (signInError) {
      setIsChangingPassword(false);
      toast.error('Current password incorrect', {
        description: 'Please check your current password and try again.',
      });
      return;
    }
    
    // Update password
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });
    
    setIsChangingPassword(false);
    
    if (updateError) {
      toast.error('Error changing password', {
        description: updateError.message,
      });
    } else {
      toast.success('Password changed', {
        description: 'Your password has been updated successfully.',
      });

      // Broadcast password change to Central Auth via backend (non-blocking)
      if (user?.email) {
        const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
        const backendUrl = import.meta.env.VITE_BACKEND_URL || (isLocal ? 'http://localhost:4000' : 'https://dent-enterprise-api.dentpulse.com');
        const { data: { session: sess } } = await supabase.auth.getSession();
        if (sess?.access_token) {
          const centralAuthToken = localStorage.getItem('central_auth_token');
          fetch(`${backendUrl}/api/password-broadcast`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${sess.access_token}`,
              ...(centralAuthToken ? { 'X-Central-Auth-Token': centralAuthToken } : {}),
            },
            body: JSON.stringify({ email: user.email, new_password: newPassword }),
          }).catch(() => {}); // fire-and-forget
        }
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
  };

  const handleSave = async () => {
    if (!user) return;
    
    setIsSaving(true);
    
    const { error } = await updateProfile({
      full_name: fullName,
      avatar_url: avatarUrl,
    });
    
    setIsSaving(false);
    
    if (error) {
      toast.error('Error saving profile', {
        description: error.message,
      });
    } else {
      toast.success('Profile updated', {
        description: 'Your profile has been saved successfully.',
      });
    }
  };

  if (authLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <Helmet>
        <title>User Profile Settings</title>
        <meta name="description" content="Manage your personal profile, preferences, avatar, password, and notification settings." />
      </Helmet>
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <User className="w-6 h-6" />
              Profile Settings
            </h1>
            <p className="text-muted-foreground">Manage your personal information and preferences</p>
          </div>
        </div>

        {/* Profile Information */}
        <Card>
          <CardHeader>
            <CardTitle>Personal Information</CardTitle>
            <CardDescription>Update your profile details and photo</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Avatar */}
            <div className="flex items-center gap-6">
              <ImageUpload
                value={avatarUrl || undefined}
                onChange={handleAvatarChange}
                variant="avatar"
                className="w-24 h-24"
              />
              <div className="space-y-1">
                <p className="text-sm font-medium">Profile Photo</p>
                <p className="text-xs text-muted-foreground">
                  JPG, PNG or GIF. Max size 5MB.
                </p>
              </div>
            </div>

            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Enter your full name"
                  className="pl-10"
                />
              </div>
            </div>

            {/* Email (read-only) */}
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="email"
                  value={user?.email || ''}
                  readOnly
                  className="pl-10 bg-muted"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Email cannot be changed. Contact support if you need to update it.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Preferences */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="w-5 h-5" />
              Preferences
            </CardTitle>
            <CardDescription>Customize your experience</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label>Theme</Label>
                <Select 
                  value={preferences.theme} 
                  onValueChange={(value) => setPreferences(p => ({ ...p, theme: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                    <SelectItem value="system">System</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>Language</Label>
                <Select 
                  value={preferences.language} 
                  onValueChange={(value) => setPreferences(p => ({ ...p, language: value }))}
                >
                  <SelectTrigger>
                    <Globe className="w-4 h-4 mr-2" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en-GB">English (UK)</SelectItem>
                    <SelectItem value="en-US">English (US)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Password Change */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="w-5 h-5" />
              Change Password
            </CardTitle>
            <CardDescription>Update your account password</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="currentPassword"
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  className="pl-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="newPassword"
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="pl-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm New Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="confirmPassword"
                  type={showNewPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  className="pl-10"
                />
              </div>
            </div>
            
            <Button 
              onClick={handlePasswordChange} 
              disabled={isChangingPassword || !currentPassword || !newPassword || !confirmPassword}
              variant="secondary"
              className="gap-2"
            >
              <Lock className="w-4 h-4" />
              {isChangingPassword ? 'Changing...' : 'Change Password'}
            </Button>
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5" />
              Notification Preferences
            </CardTitle>
            <CardDescription>Choose how you want to be notified</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Email Notifications</p>
                <p className="text-sm text-muted-foreground">Receive important updates via email</p>
              </div>
              <Switch
                checked={preferences.emailNotifications}
                onCheckedChange={(checked) => setPreferences(p => ({ ...p, emailNotifications: checked }))}
              />
            </div>
            
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Weekly Digest</p>
                <p className="text-sm text-muted-foreground">Get a summary of activity every week</p>
              </div>
              <Switch
                checked={preferences.weeklyDigest}
                onCheckedChange={(checked) => setPreferences(p => ({ ...p, weeklyDigest: checked }))}
              />
            </div>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isSaving} className="gap-2">
            <Save className="w-4 h-4" />
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </MainLayout>
  );
}
