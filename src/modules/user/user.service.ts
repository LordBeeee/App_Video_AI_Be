import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  findByEmail(email: string) {
    return this.userRepository.findOne({
      where: { email },
    });
  }
  
  findAll() {
    return this.userRepository.find()
  }
  
  async updateLastLogin(userId: number) {
    await this.userRepository.update(userId, {
      lastLoginAt: new Date(),
      updatedAt: new Date(),
    });
  }
}