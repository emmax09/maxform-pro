import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, Users, Database, Activity, Settings, Lock } from "lucide-react";

export default function AdminDashboard() {
  const { user, profile } = useAuth();

  return (
    <AppLayout>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="px-4 md:px-6 h-14 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Shield className="h-5 w-5 text-primary" />
            <h1 className="text-[14px] font-semibold">Admin Dashboard</h1>
            <Badge variant="destructive" className="text-[10px] h-5">
              ADMIN ONLY
            </Badge>
          </div>
          <div className="text-[12px] text-muted-foreground">
            Logged in as: <span className="text-foreground font-medium">{profile?.full_name}</span>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 md:p-6">
          <div className="max-w-7xl mx-auto space-y-6">
            {/* Welcome Section */}
            <Card className="border-2 border-primary/20 bg-primary/5">
              <CardHeader>
                <CardTitle className="text-[16px] flex items-center gap-2">
                  <Shield className="h-5 w-5 text-primary" />
                  Welcome to Admin Control Panel
                </CardTitle>
                <CardDescription>
                  You have full administrative access to manage users, settings, and system configurations.
                </CardDescription>
              </CardHeader>
            </Card>

            {/* Admin Features Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {/* User Management */}
              <Card className="hover:border-primary transition-colors cursor-pointer">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Users className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-[14px]">User Management</CardTitle>
                      <CardDescription className="text-[11px]">Manage all users</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-[12px] text-muted-foreground">
                    Create, edit, delete users and manage their roles and permissions.
                  </p>
                </CardContent>
              </Card>

              {/* Database Management */}
              <Card className="hover:border-primary transition-colors cursor-pointer">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                      <Database className="h-5 w-5 text-blue-500" />
                    </div>
                    <div>
                      <CardTitle className="text-[14px]">Database</CardTitle>
                      <CardDescription className="text-[11px]">Database operations</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-[12px] text-muted-foreground">
                    Run migrations, backups, and monitor database health.
                  </p>
                </CardContent>
              </Card>

              {/* System Activity */}
              <Card className="hover:border-primary transition-colors cursor-pointer">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center">
                      <Activity className="h-5 w-5 text-green-500" />
                    </div>
                    <div>
                      <CardTitle className="text-[14px]">Activity Logs</CardTitle>
                      <CardDescription className="text-[11px]">Monitor system activity</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-[12px] text-muted-foreground">
                    View all system activities, user actions, and audit trails.
                  </p>
                </CardContent>
              </Card>

              {/* System Settings */}
              <Card className="hover:border-primary transition-colors cursor-pointer">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                      <Settings className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-[14px]">System Settings</CardTitle>
                      <CardDescription className="text-[11px]">Configure system</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-[12px] text-muted-foreground">
                    Manage global settings, integrations, and configurations.
                  </p>
                </CardContent>
              </Card>

              {/* Security */}
              <Card className="hover:border-primary transition-colors cursor-pointer">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-10 w-10 rounded-full bg-red-500/10 flex items-center justify-center">
                      <Lock className="h-5 w-5 text-red-500" />
                    </div>
                    <div>
                      <CardTitle className="text-[14px]">Security</CardTitle>
                      <CardDescription className="text-[11px]">Security settings</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-[12px] text-muted-foreground">
                    Configure authentication, permissions, and security policies.
                  </p>
                </CardContent>
              </Card>

              {/* Role Management */}
              <Card className="hover:border-primary transition-colors cursor-pointer">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-10 w-10 rounded-full bg-purple-500/10 flex items-center justify-center">
                      <Shield className="h-5 w-5 text-purple-500" />
                    </div>
                    <div>
                      <CardTitle className="text-[14px]">Role Management</CardTitle>
                      <CardDescription className="text-[11px]">Manage user roles</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-[12px] text-muted-foreground">
                    Create and manage custom roles with specific permissions.
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Security Notice */}
            <Card className="border-2 border-destructive/20 bg-destructive/5">
              <CardHeader>
                <CardTitle className="text-[14px] flex items-center gap-2 text-destructive">
                  <Lock className="h-4 w-4" />
                  Security Notice
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-[12px] text-muted-foreground">
                  ⚠️ You are in a highly privileged area. All actions are logged and monitored.
                </p>
                <p className="text-[12px] text-muted-foreground">
                  🔒 Only admin users can access this area. Unauthorized access attempts will be reported.
                </p>
                <p className="text-[12px] text-muted-foreground">
                  📋 Your activity: <span className="font-mono text-foreground">{user?.email}</span> - Role: <Badge variant="destructive" className="text-[10px]">ADMIN</Badge>
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
