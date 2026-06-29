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
