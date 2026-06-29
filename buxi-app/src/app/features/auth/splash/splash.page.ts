import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from '../../../core/services/supabase.service';

@Component({
  selector: 'app-splash',
  templateUrl: './splash.page.html',
  styleUrls: ['./splash.page.scss'],
  standalone: false,
})
export class SplashPage implements OnInit {
  constructor(private router: Router, private supabase: SupabaseService) {}

  ngOnInit() {
    setTimeout(async () => {
      const session = this.supabase.currentSession;
      if (session) {
        this.router.navigate(['/passenger/map'], { replaceUrl: true });
      } else {
        this.router.navigate(['/auth/login'], { replaceUrl: true });
      }
    }, 2500);
  }
}
