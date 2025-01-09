import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getTroll() {
    return 'GME to the moon!';
  }
}
