import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
import { NoAuthGuard } from './core/guards/no-auth.guard';
import { RoleGuard } from './core/guards/role.guard';

const routes: Routes = [
  { path: '', redirectTo: 'splash', pathMatch: 'full' },
  { path: 'splash', loadChildren: () => import('./features/auth/splash/splash.module').then(m => m.SplashPageModule) },
  { path: 'auth/login', loadChildren: () => import('./features/auth/login/login.module').then(m => m.LoginPageModule), canActivate: [NoAuthGuard] },
  { path: 'auth/register', loadChildren: () => import('./features/auth/register/register.module').then(m => m.RegisterPageModule), canActivate: [NoAuthGuard] },
  { path: 'auth/empresa-request', loadChildren: () => import('./features/auth/empresa-request/empresa-request.module').then(m => m.EmpresaRequestPageModule) },
  { path: 'legal/privacy', loadChildren: () => import('./features/legal/privacy/privacy.module').then(m => m.PrivacyPageModule) },
  { path: 'legal/terms', loadChildren: () => import('./features/legal/terms/terms.module').then(m => m.TermsPageModule) },
  { path: 'auth/forgot-password', loadChildren: () => import('./features/auth/forgot-password/forgot-password.module').then(m => m.ForgotPasswordPageModule), canActivate: [NoAuthGuard] },
  { path: 'passenger/map', loadChildren: () => import('./features/passenger/map/map.module').then(m => m.MapPageModule), canActivate: [RoleGuard], data: { roles: ['pasajero'] } },

  // La experiencia del pasajero vive entera sobre el mapa: rutas, favoritos,
  // alertas y perfil son paneles flotantes, no pantallas. Estas cuatro rutas
  // son las pantallas anteriores; se redirigen en vez de borrarse para que un
  // marcador o un enlace viejo no caiga en un 404 — ni en el diseño anterior,
  // que es a donde llevaban hasta ahora arrastrando su propia barra inferior.
  { path: 'passenger/home', redirectTo: 'passenger/map', pathMatch: 'full' },
  { path: 'passenger/routes', redirectTo: 'passenger/map', pathMatch: 'full' },
  { path: 'passenger/empresas', redirectTo: 'passenger/map', pathMatch: 'full' },
  { path: 'passenger/profile', redirectTo: 'passenger/map', pathMatch: 'full' },
  {
    path: 'admin/dashboard',
    loadChildren: () => import('./features/admin/dashboard/admin-dashboard.module').then(m => m.AdminDashboardPageModule),
    canActivate: [RoleGuard], data: { roles: ['admin_jirb'] },
  },
  {
    path: 'empresa/dashboard',
    loadChildren: () => import('./features/empresa/dashboard/dashboard.module').then(m => m.EmpresaDashboardPageModule),
    canActivate: [RoleGuard], data: { roles: ['admin_empresa', 'admin_jirb'] },
  },
  {
    path: 'chofer/home',
    loadChildren: () => import('./features/chofer/home/chofer-home.module').then(m => m.ChoferHomePageModule),
    canActivate: [RoleGuard], data: { roles: ['chofer', 'admin_jirb'] },
  },
  { path: '**', redirectTo: 'splash' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })],
  exports: [RouterModule],
})
export class AppRoutingModule {}
