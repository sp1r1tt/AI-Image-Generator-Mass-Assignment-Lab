import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  username: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string; 

  @Column({ nullable: true })
  fullName?: string;

  @Column({ type: 'json', nullable: true })
  profile: Record<string, any> = {};

  @Column({ default: 5 })
  generationCredits: number;

  @Column({ default: 'free' })
  plan: string;

  @Column({ type: 'json', nullable: true })
  features: Record<string, any> = {};

  @Column({ default: 5 })
  dailyLimit: number;

  @CreateDateColumn()
  createdAt: Date;
}