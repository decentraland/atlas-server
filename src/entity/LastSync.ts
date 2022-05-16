import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, DeleteDateColumn, UpdateDateColumn } from "typeorm"

@Entity()
export class LastSync {
    @PrimaryGeneratedColumn()
    id: number

    @Column()
    lastSyncedAt: number

    @CreateDateColumn({ nullable: true })
    createdAt?: Date

    @UpdateDateColumn({ nullable: true })
    modifiedAt?: Date

    @DeleteDateColumn({ nullable: true })
    deletedAt?: Date
}
