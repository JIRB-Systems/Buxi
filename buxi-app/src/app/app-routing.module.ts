import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
import { AuthGuard } from './core/guards/auth.guard';
import { NoAuthGuard } from './core/guards/no-auth.guard';

const routes: Routes = [
  {
    path: '',
    redirectTo: 'splash',
    pathMatch: 'full',
  },
  {
    path: 'splash',
    loadChildren: () => import('./features/auth/splash/splash.module').then(m => m.SplashPageModule),
  },
  {
    path: 'auth/login',
    loadChildren: () => import('./features/auth/login/login.module').then(m => m.LoginPageModule),
    canActivate: [NoAuthGuard],
  },
  {
    path: 'auth/register',
    loadChildren: () => import('./features/auth/register/register.module').then(m => m.RegisterPageModule),
    canActivate: [NoAuthGuard],
  },
  {
    path: 'auth/forgot-password',
    loadChildren: () => import('./features/auth/forgot-password/forgot-password.module').then(m => m.ForgotPasswordPageModule),
    canActivate: [NoAuthGuard],
  },
  {
    path: 'passenger/home',
    loadChildren: () => import('./features/passenger/home/home.module').then(m => m.PassengerHomePageModule),
    canActivate: [AuthGuard],
  },
  {
    path: 'passenger/map',
    loadChildren: () => import('./features/passenger/map/map.module').then(m => m.MapPageModule),
    canActivate: [AuthGuard],
  },
  {
    path: 'passenger/routes',
    loadChildren: () => import('./features/passenger/routes/routes.module').then(m => m.RoutesPageModule),
    canActivate: [AuthGuard],
  },
  {
    path: 'passenger/profile',
    loadChildren: () => import('./features/passenger/profile/profile.module').then(m => m.ProfilePageModule),
    canActivate: [AuthGuard],
  },
  {
    path: 'empresa/dashboard',
    loadChildren: () => import('./features/empresa/dashboard/dashboard.module').then(m => m.EmpresaDashboardPageModule),
    canActivate: [AuthGuard],
  },
  {
    path: 'chofer/home',
    loadChildren: () => import('./features/chofer/home/chofer-home.module').then(m => m.ChoferHomePageModule),
    canActivate: [AuthGuard],
  },
  {
    path: '**',
    redirectTo: 'splash',
  },
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules }),
  ],
  exports: [RouterModule],
})
export class AppRoutingModule {}
