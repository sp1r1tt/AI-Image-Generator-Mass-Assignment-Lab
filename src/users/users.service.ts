import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { SafeUpdateSchema } from './dto/safe-update.schema';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private repo: Repository<User>) {}

  async create(data: any): Promise<User> {
    const user = this.repo.create(data as Partial<User>);
    return this.repo.save(user);
  }

  async findById(id: string): Promise<any> {
    const user = await this.repo.findOneBy({ id });
    if (!user) throw new NotFoundException('User not found');

    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      profile: {
        bio: user.profile?.bio,
        website: user.profile?.website,
        avatarUrl: user.profile?.avatarUrl,
      },
      createdAt: user.createdAt,
    };
  }

  async generateImage(userId: string): Promise<any> {
    const user = await this.repo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('User not found');

    const isPremium = user.plan === 'pro' || user.plan === 'enterprise' || user.features?.unlimitedGenerations;

    if (!isPremium && user.generationCredits <= 0) {
      throw new BadRequestException({
        error: 'Limit exceeded',
        message: 'You have 0 generation credits left. Upgrade to Pro for unlimited access.',
        hint: 'Maybe you can find a way to become a Pro user?',
      });
    }

    if (!isPremium) {
      user.generationCredits -= 1;
      await this.repo.save(user);
    }

    return {
      status: 'success',
      message: 'Image generated successfully!',
      plan: user.plan,
      model: isPremium ? 'Flux.1 Pro (Enterprise Edition)' : 'Stable Diffusion v1.5 (Legacy)',
      features: {
        priorityQueue: isPremium ? true : false,
        aiUpscale: isPremium ? true : false,
        customModels: isPremium ? true : false,
      },
      remainingCredits: isPremium ? 'unlimited' : user.generationCredits,
      imageUrl: `https://api.ai-gen-lab.io/v1/assets/generated/${Math.random().toString(36).substring(7)}.png`,
    };
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.repo.findOneBy({ email });
  }

  async updateFlat(id: string, raw: any, requesterId: string): Promise<any> {
    const user = await this.repo.findOneBy({ id });
    if (!user || user.id !== requesterId) throw new UnauthorizedException();

    Object.assign(user, raw);
    await this.repo.save(user);
    return this.findById(id);
  }

  async updateFull(id: string, raw: any, requesterId: string): Promise<any> {
    const user = await this.repo.findOneBy({ id });
    if (!user || user.id !== requesterId) throw new UnauthorizedException();

    Object.assign(user, raw);
    const saved = await this.repo.save(user);
    const { password, ...rest } = saved;
    return rest;
  }

  async updateNested(id: string, raw: any, requesterId: string): Promise<any> {
    const user = await this.repo.findOneBy({ id });
    if (!user || user.id !== requesterId) throw new UnauthorizedException();

    if (raw.fullName !== undefined) user.fullName = raw.fullName;

  
    if (raw.profile) {
      user.profile = { ...user.profile, ...raw.profile };
    }

    if (raw.features) {
      user.features = { ...user.features, ...raw.features };
    }

    await this.repo.save(user);
    return this.findById(id);
  }

  async safeUpdate(id: string, raw: unknown, requesterId: string): Promise<any> {
    const user = await this.repo.findOneBy({ id });
    if (!user || user.id !== requesterId) throw new UnauthorizedException();

    const parsed = SafeUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const data = parsed.data;

    if (data.fullName !== undefined) user.fullName = data.fullName;

    if (data.profile) {
      user.profile = {
        ...user.profile,
        bio: data.profile.bio ?? user.profile?.bio,
        website: data.profile.website ?? user.profile?.website,
        avatarUrl: data.profile.avatarUrl ?? user.profile?.avatarUrl,
      };
    }

    await this.repo.save(user);
    return this.findById(id);
  }
}