import { Entity, PrimaryGeneratedColumn, Column } from "typeorm"

@Entity()
export class LastSync {
    @PrimaryGeneratedColumn()
    id: number

    @Column()
    updatedAt: number
}
