import { Entity, PrimaryGeneratedColumn, Column } from "typeorm"

@Entity()
export class LatestUpdateOn {
    @PrimaryGeneratedColumn()
    id: number

    @Column()
    latestUpdateOn: number
}
